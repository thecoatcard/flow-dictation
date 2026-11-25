/**
 * Mutes and unmutes the default Windows output device through Core Audio (IAudioEndpointVolume),
 * called via koffi like win-foreground.ts. Windows only; everywhere else, and on any failure, these
 * report "unknown" and do nothing, so dictation never depends on it.
 */
interface Endpoint {
  get(): boolean;
  set(muted: boolean): boolean;
}

let endpoint: Endpoint | null | undefined; // undefined = not tried yet, null = unavailable

function load(): Endpoint | null {
  if (process.platform !== 'win32') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const ole32 = koffi.load('ole32.dll');
    koffi.struct('GUID', { d1: 'uint32', d2: 'uint16', d3: 'uint16', d4: koffi.array('uint8', 8) });
    const guid = (s: string) => {
      const b = Buffer.from(s.replace(/[{}-]/g, ''), 'hex');
      return {
        d1: b.readUInt32BE(0),
        d2: b.readUInt16BE(4),
        d3: b.readUInt16BE(6),
        d4: [...b.subarray(8, 16)],
      };
    };
    const CoInitializeEx = ole32.func(
      'int32 __stdcall CoInitializeEx(void* reserved, uint32 flags)',
    );
    const CoCreateInstance = ole32.func(
      'int32 __stdcall CoCreateInstance(GUID* clsid, void* outer, uint32 ctx, GUID* iid, _Out_ void** ppv)',
    );
    const Release = koffi.proto('uint32 __stdcall Release(void* self)');
    const GetDefaultAudioEndpoint = koffi.proto(
      'int32 __stdcall GetDefaultAudioEndpoint(void* self, int flow, int role, _Out_ void** dev)',
    );
    const Activate = koffi.proto(
      'int32 __stdcall Activate(void* self, GUID* iid, uint32 ctx, void* params, _Out_ void** out)',
    );
    const GetMute = koffi.proto('int32 __stdcall GetMute(void* self, _Out_ int32_t* muted)');
    const SetMute = koffi.proto('int32 __stdcall SetMute(void* self, int32 mute, void* ctx)');

    // COM objects start with a pointer to a table of methods; call the one at `index`.
    const method = (obj: unknown, index: number, proto: unknown) => {
      const vtbl = koffi.decode(obj, 'void *');
      const fn = koffi.decode(vtbl, index * koffi.sizeof('void *'), 'void *');
      return koffi.decode(fn, proto);
    };
    CoInitializeEx(null, 0x2); // may report it was already initialized, which is fine

    /** Runs `use` with the default output's IAudioEndpointVolume, then releases everything. */
    const withVolume = <T>(use: (vol: unknown) => T): T => {
      const en: unknown[] = [null];
      const dev: unknown[] = [null];
      const vol: unknown[] = [null];
      const CLSCTX_ALL = 0x17;
      const hr = CoCreateInstance(
        guid('BCDE0395-E52F-467C-8E3D-C4579291692E'),
        null,
        CLSCTX_ALL,
        guid('A95664D2-9614-4F35-A746-DE8DB63617E6'),
        en,
      );
      if (hr < 0 || !en[0]) throw new Error('no audio enumerator');
      try {
        if (method(en[0], 4, GetDefaultAudioEndpoint)(en[0], 0, 1, dev) < 0 || !dev[0])
          throw new Error('no output device');
        try {
          const iid = guid('5CDF2C82-841E-4546-9722-0CF74078229A');
          if (method(dev[0], 3, Activate)(dev[0], iid, CLSCTX_ALL, null, vol) < 0 || !vol[0])
            throw new Error('no volume control');
          try {
            return use(vol[0]);
          } finally {
            method(vol[0], 2, Release)(vol[0]);
          }
        } finally {
          method(dev[0], 2, Release)(dev[0]);
        }
      } finally {
        method(en[0], 2, Release)(en[0]);
      }
    };
    return {
      get: () =>
        withVolume((v) => {
          const out = [0];
          method(v, 15, GetMute)(v, out);
          return out[0] !== 0;
        }),
      set: (muted) => withVolume((v) => method(v, 14, SetMute)(v, muted ? 1 : 0, null) >= 0),
    };
  } catch {
    return null;
  }
}

/** True/false when known; undefined when this PC cannot be queried. */
export function isOutputMuted(): boolean | undefined {
  endpoint ??= load();
  try {
    return endpoint?.get();
  } catch {
    return undefined;
  }
}

export function setOutputMuted(muted: boolean): boolean {
  endpoint ??= load();
  try {
    return endpoint?.set(muted) ?? false;
  } catch {
    return false;
  }
}
