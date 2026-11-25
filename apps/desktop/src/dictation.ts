import type { Command, PipelineResult, SttResult, UsageTotals } from '@flow/core';

/** Keys and shortcuts the inserter can press for spoken commands. */
export type KeyAction = 'enter' | 'tab' | 'escape' | 'select-all' | 'undo';

const COMMAND_KEYS: Record<Exclude<Command, 'delete-last'>, { key: KeyAction; label: string }> = {
  'select-all': { key: 'select-all', label: 'Selected all' },
  undo: { key: 'undo', label: 'Undone' },
  'press-enter': { key: 'enter', label: 'Enter' },
  'press-tab': { key: 'tab', label: 'Tab' },
  'press-escape': { key: 'escape', label: 'Escape' },
};

export type OverlayStatus =
  { state: 'hidden' } | { state: 'listening' | 'processing' | 'done' | 'error'; message?: string };

export interface DictationDeps {
  mic: { start(onChunk: (c: Uint8Array) => void): Promise<void>; stop(): Promise<void> };
  newStt(): { pushAudio(c: Uint8Array): void; finish(): Promise<SttResult> };
  /** Cleanup + snippets/commands. Must not throw; falls back to raw text itself. */
  process(transcript: string, appId?: string): Promise<PipelineResult>;
  /** Id of the focused app, for tone selection. Called at key-down, while the user's app still has focus. */
  activeApp?(): Promise<string | undefined>;
  inserter: {
    insert(text: string): Promise<void>;
    undoLast(): Promise<void>;
    press(key: KeyAction): Promise<void>;
  };
  overlay(s: OverlayStatus): void;
  /** Timings and error types only. Never transcripts. */
  log(event: string, data?: Record<string, number | string | boolean>): void;
  now(): number;
  /** A short tone at the start and end of recording. */
  cue?(kind: 'start' | 'stop'): void;
  /** Lowers other sound while recording (`begin`) and restores it (`end`). Both may be called more than once. */
  media?: { begin(): void; end(): void };
  /** The final inserted text and the app it went into, for the history page. */
  recordHistory?(entry: { text: string; app?: string }): void;
  /** Billable usage for cost tracking (counts only). */
  recordUsage?(u: Partial<UsageTotals>): void;
  /** User-facing text for a failure (bad key, offline, quota...). */
  describeError?(e: unknown): string;
}

export type DictationState = 'idle' | 'recording' | 'transcribing' | 'cleaning' | 'inserting';

/** Push-to-talk state machine: idle -> recording -> transcribing -> cleaning -> inserting -> idle. */
export class Dictation {
  state: DictationState = 'idle';
  /** Last text produced, kept even if insertion failed ("Copy last dictation"). */
  lastText = '';
  private lastInserted = false;
  private stt: ReturnType<DictationDeps['newStt']> | null = null;
  private starting: Promise<void> | null = null;
  private cued = false; // the start tone played, so the stop tone should too
  private app: Promise<string | undefined> = Promise.resolve(undefined);

  constructor(private readonly d: DictationDeps) {}

  /** Hotkey pressed. Ignored unless idle, which also swallows key auto-repeat and double-presses. */
  async keyDown(): Promise<void> {
    if (this.state !== 'idle') return;
    this.state = 'recording';
    this.d.overlay({ state: 'listening' });
    const stt = this.d.newStt();
    this.stt = stt;
    this.app = (this.d.activeApp?.() ?? Promise.resolve(undefined)).catch(() => undefined);
    this.starting = this.d.mic.start((c) => stt.pushAudio(c));
    try {
      await this.starting;
      if (this.state === 'recording') {
        // The mic is live: the tone tells the user they can speak, then other sound is lowered.
        this.cued = true;
        this.d.cue?.('start');
        this.d.media?.begin();
      }
    } catch (e) {
      // Mic failed (unplugged, permission). If keyUp already ran it handles cleanup itself.
      if (this.state === 'recording') await this.fail('mic', 'Microphone unavailable', e);
    }
  }

  /** Hotkey released: run the rest of the pipeline. */
  async keyUp(): Promise<void> {
    if (this.state !== 'recording') return;
    this.state = 'transcribing';
    this.d.overlay({ state: 'processing' });
    const t0 = this.d.now();
    const stt = this.stt;
    this.stt = null;
    try {
      await this.starting?.catch(() => undefined);
      await this.d.mic.stop();
      this.d.media?.end();
      if (this.cued) this.d.cue?.('stop');
      this.cued = false;
      const r = await stt!.finish();
      this.d.recordUsage?.({ audioSeconds: r.audioSeconds, dictations: 1 });
      this.d.log('stt', { ms: this.d.now() - t0, finalizeMs: r.finalizeMs, timedOut: r.timedOut });
      if (!r.text.trim()) return this.finish({ state: 'hidden' });

      this.state = 'cleaning';
      const t1 = this.d.now();
      const appId = await this.app;
      const result = await this.d.process(r.text, appId);
      this.d.log('cleanup', { ms: this.d.now() - t1 });

      if (result.kind === 'command') {
        if (result.command === 'delete-last') {
          if (this.lastInserted) await this.d.inserter.undoLast();
          this.lastInserted = false;
          return this.finish({ state: 'done', message: 'Removed' });
        }
        const action = COMMAND_KEYS[result.command];
        this.state = 'inserting';
        await this.d.inserter.press(action.key);
        return this.finish({ state: 'done', message: action.label });
      }
      if (!result.text && !result.pressEnter) return this.finish({ state: 'hidden' });

      this.state = 'inserting';
      const t2 = this.d.now();
      if (result.text) {
        this.lastText = result.text;
        await this.d.inserter.insert(result.text);
        this.lastInserted = true;
        this.d.recordHistory?.({ text: result.text, app: appId });
      }
      if (result.pressEnter) await this.d.inserter.press('enter');
      this.d.log('insert', { ms: this.d.now() - t2, total: this.d.now() - t0 });
      this.finish({ state: 'done' });
    } catch (e) {
      await this.fail(this.state, 'Dictation failed', e);
    }
  }

  private finish(o: OverlayStatus): void {
    this.state = 'idle';
    this.d.overlay(o);
  }

  private async fail(stage: string, message: string, e: unknown): Promise<void> {
    this.d.log('error', {
      stage,
      type: e instanceof Error ? e.constructor.name : typeof e,
      detail: e instanceof Error ? e.message.slice(0, 300) : '',
    });
    message = this.d.describeError?.(e) ?? message;
    this.stt?.finish().catch(() => undefined); // close the socket
    this.stt = null;
    await this.d.mic.stop().catch(() => undefined);
    this.d.media?.end();
    this.cued = false;
    this.state = 'idle';
    this.d.overlay({ state: 'error', message });
  }
}
