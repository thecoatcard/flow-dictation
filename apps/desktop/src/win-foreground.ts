import * as path from 'node:path';

/**
 * Foreground process name on Windows via Win32 (user32/kernel32) through koffi, which ships
 * prebuilt binaries. active-win's Windows addon has to be compiled locally, which we can't rely on.
 */
let lookup: (() => string | undefined) | null = null;

function load(): () => string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()');
  const GetWindowThreadProcessId = user32.func(
    'uint32 __stdcall GetWindowThreadProcessId(void* hwnd, _Out_ uint32_t* pid)',
  );
  const OpenProcess = kernel32.func(
    'void* __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)',
  );
  const QueryName = kernel32.func(
    'bool __stdcall QueryFullProcessImageNameW(void* h, uint32 flags, _Out_ uint16_t* buf, _Inout_ uint32_t* size)',
  );
  const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void* h)');
  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

  return () => {
    const hwnd = GetForegroundWindow();
    if (!hwnd) return undefined;
    const pid = [0];
    GetWindowThreadProcessId(hwnd, pid);
    const proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid[0]);
    if (!proc) return undefined;
    try {
      const buf = new Uint16Array(1024);
      const size = [buf.length];
      if (!QueryName(proc, 0, buf, size)) return undefined;
      const full = Buffer.from(buf.buffer, 0, size[0] * 2).toString('utf16le');
      return path.win32.basename(full);
    } finally {
      CloseHandle(proc);
    }
  };
}

let titleLookup: (() => string | undefined) | null = null;

function loadTitle(): () => string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()');
  const GetWindowTextW = user32.func(
    'int __stdcall GetWindowTextW(void* hwnd, _Out_ uint16_t* buf, int max)',
  );
  return () => {
    const hwnd = GetForegroundWindow();
    if (!hwnd) return undefined;
    const buf = new Uint16Array(512);
    const n = GetWindowTextW(hwnd, buf, buf.length);
    return n > 0 ? Buffer.from(buf.buffer, 0, n * 2).toString('utf16le') : undefined;
  };
}

/** Title of the foreground window on Windows, if it has one. */
export function foregroundWindowTitle(): string | undefined {
  titleLookup ??= loadTitle();
  return titleLookup();
}

export function foregroundProcessName(): string | undefined {
  lookup ??= load();
  return lookup();
}
