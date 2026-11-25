import { GoogleGenAI, Modality, type LiveServerMessage } from '@google/genai';

export const STT_MIME = 'audio/pcm;rate=16000';

/** The slice of a Live session we use. Lets tests inject a fake. */
export interface LiveSessionLike {
  sendRealtimeInput(p: {
    audio?: { data: string; mimeType: string };
    audioStreamEnd?: boolean;
  }): void;
  close(): void;
}

export interface LiveHandlers {
  onmessage: (m: LiveServerMessage) => void;
  onerror: (e: unknown) => void;
  onclose: (e?: unknown) => void;
}

export type LiveConnect = (h: LiveHandlers) => Promise<LiveSessionLike>;

export interface SttResult {
  text: string;
  /** Time from end-of-audio signal to result. */
  finalizeMs: number;
  /** Audio sent, for cost tracking. */
  audioSeconds: number;
  /** True when we gave up waiting for the server and used the best text so far. */
  timedOut: boolean;
}

export class SttError extends Error {}

/** Readable text for Error, ErrorEvent and CloseEvent alike (String() gives "[object Event]"). */
function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null) {
    const o = e as { message?: unknown; code?: unknown; reason?: unknown };
    const parts = [o.code, o.reason, o.message].filter((x) => x !== undefined && x !== '');
    if (parts.length) return parts.map(String).join(' ');
  }
  return e === undefined ? '' : String(e);
}

export function geminiLiveConnect(
  apiKey: string,
  model: string,
  vocabulary: string[] = [],
): LiveConnect {
  // The SDK defaults to API v1, but Live (and these models) are served on v1beta: v1 gives a 404.
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1beta' } });
  return (h) =>
    ai.live.connect({
      model,
      config: {
        responseModalities: [Modality.TEXT],
        inputAudioTranscription: vocabulary.length ? { customVocabulary: vocabulary } : {},
      },
      callbacks: { onmessage: h.onmessage, onerror: h.onerror, onclose: (e) => h.onclose(e) },
    });
}

export interface SttOptions {
  /** Hard cap on waiting for the final transcript after audio ends. */
  finalizeTimeoutMs?: number;
  /**
   * Finish early once no new transcript text has arrived for this long after the audio ended.
   * The server sometimes never sends turnComplete; waiting out the hard cap then costs seconds.
   */
  quietMs?: number;
  /** Same, when nothing has been transcribed at all (silence), so "no speech" answers quickly. */
  emptyMs?: number;
}

/**
 * One push-to-talk utterance. Call pushAudio() while recording (safe before the socket is open),
 * then finish() once. Transcript = all final chunks in order + the latest interim tail.
 */
export class SttSession {
  private session: LiveSessionLike | null = null;
  private connecting: Promise<void>;
  private pending: Uint8Array[] = [];
  private finals = '';
  private interim = '';
  private error: unknown = null;
  private closed = false;
  private closeInfo = '';
  private bytes = 0;
  private lastActivity = 0;
  private done: (() => void) | null = null;

  constructor(
    private readonly connect: LiveConnect,
    private readonly opts: SttOptions = {},
  ) {
    this.connecting = this.open();
    this.connecting.catch(() => undefined); // surfaced from finish()
  }

  private handlers(): LiveHandlers {
    return {
      onmessage: (m) => {
        const c = m.serverContent;
        if (!c) return;
        if (c.inputTranscription?.text) {
          const t = c.inputTranscription.text;
          // Chunks normally append; some modes send the cumulative transcript instead.
          this.finals = this.finals && t.startsWith(this.finals) ? t : this.finals + t;
          this.interim = '';
        }
        if (c.interimInputTranscription?.text) this.interim = c.interimInputTranscription.text;
        if (c.inputTranscription?.text || c.interimInputTranscription?.text)
          this.lastActivity = Date.now();
        if (c.turnComplete || c.generationComplete) this.done?.();
      },
      onerror: (e) => {
        this.error = e;
        this.done?.();
      },
      onclose: (e) => {
        this.closed = true;
        this.closeInfo = describe(e);
        this.done?.();
      },
    };
  }

  /** One retry on connect failure; push-to-talk sessions are too short for anything fancier. */
  private async open(): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        this.session = await this.connect(this.handlers());
        for (const chunk of this.pending) this.send(chunk);
        this.pending = [];
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    throw new SttError(`could not connect: ${describe(lastErr)}`);
  }

  private send(chunk: Uint8Array): void {
    this.session?.sendRealtimeInput({
      audio: { data: Buffer.from(chunk).toString('base64'), mimeType: STT_MIME },
    });
  }

  pushAudio(chunk: Uint8Array): void {
    this.bytes += chunk.length;
    if (this.session && !this.closed) this.send(chunk);
    else if (!this.session) this.pending.push(chunk);
  }

  /** Best text so far (finals + interim). */
  get text(): string {
    const f = this.finals;
    const i = this.interim;
    // Some modes send the interim as the whole transcript so far; appending it would say everything twice.
    if (f && i && (i.startsWith(f) || f.trimEnd().endsWith(i.trim()))) return (i.startsWith(f) ? i : f).trim();
    return (f + i).trim();
  }

  async finish(): Promise<SttResult> {
    await this.connecting; // throws SttError if never connected
    const start = Date.now();
    let timedOut = false;
    if (!this.closed && !this.error) {
      const waited = new Promise<void>((res) => (this.done = res));
      this.session?.sendRealtimeInput({ audioStreamEnd: true });
      const timer = new Promise<'timeout'>((res) =>
        setTimeout(() => res('timeout'), this.opts.finalizeTimeoutMs ?? 3000),
      );
      // Text has arrived and then stopped arriving: that is the final transcript, even without turnComplete.
      const quietMs = this.opts.quietMs ?? 550;
      const emptyMs = this.opts.emptyMs ?? 1500;
      let poll: ReturnType<typeof setInterval> | undefined;
      const settled = new Promise<'ok'>((res) => {
        poll = setInterval(() => {
          const idle = Date.now() - Math.max(this.lastActivity, start);
          if (idle >= (this.text ? quietMs : emptyMs)) res('ok');
        }, 40);
      });
      try {
        timedOut =
          (await Promise.race([waited.then(() => 'ok' as const), settled, timer])) === 'timeout';
      } finally {
        clearInterval(poll);
      }
    }
    const result = {
      text: this.text,
      finalizeMs: Date.now() - start,
      timedOut,
      audioSeconds: this.bytes / 32000, // 16 kHz * 2 bytes
    };
    this.session?.close();
    if (!result.text && this.error)
      throw new SttError(`transcription failed: ${describe(this.error)}`);
    if (!result.text && this.closed && this.closeInfo.trim())
      throw new SttError(`connection closed: ${this.closeInfo}`);
    return result;
  }
}
