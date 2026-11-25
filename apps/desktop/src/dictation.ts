import { SpeechMeter } from './speech-gate';
import { detectAsk, type Command, type PipelineResult, type SttResult, type UsageTotals } from '@flow/core';

/** The longest selection sent as a question; the rest is cut. */
const MAX_ASK_SELECTION = 4000;

/** Keys and shortcuts the inserter can press for spoken commands. */
export type KeyAction = 'enter' | 'tab' | 'escape' | 'select-all' | 'undo' | 'delete';

const COMMAND_KEYS: Record<
  Exclude<Command, 'delete-last' | 'read-back'>,
  { key: KeyAction; label: string }
> = {
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
  process(transcript: string, appId?: string, windowTitle?: string): Promise<PipelineResult>;
  /** Id of the focused app, for tone selection. Called at key-down, while the user's app still has focus. */
  activeApp?(): Promise<string | undefined>;
  /** Title of the focused window, read at key-down like activeApp. */
  activeTitle?(): Promise<string | undefined>;
  inserter: {
    insert(text: string): Promise<void>;
    undoLast(): Promise<void>;
    press(key: KeyAction): Promise<void>;
    /** The selected text in the focused app, or ''. */
    copySelection?(): Promise<string>;
  };
  /** Command Mode: rewrites `selection` following the spoken `instruction`; null leaves it alone. */
  command?(selection: string, instruction: string, app?: string): Promise<string | null>;
  /** Ask: answers a spoken question; null when there was no answer. */
  ask?(question: string): Promise<string | null>;
  /** Shows a question and its answer in the popup. */
  showAnswer?(question: string, answer: string): void;
  /** Reads text aloud with the system voice ("read that back"). False when there is no voice to use. */
  speak?(text: string): boolean | void;
  /** The newest saved dictation, for "read that back" right after Flow starts (nothing dictated yet this session). */
  lastSaved?(): string | undefined;
  overlay(s: OverlayStatus): void;
  /** Timings and error types only. Never transcripts. */
  log(event: string, data?: Record<string, number | string | boolean>): void;
  now(): number;
  /** Keeps recording this long after the key is released, so the last word is not clipped. Default 200 ms. */
  tailMs?: number;
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
  private meter = new SpeechMeter();
  private cued = false; // the start tone played, so the stop tone should too
  /** 'command': the speech is an instruction for the selected text, not text to insert. */
  private kind: 'dictate' | 'command' | 'ask' = 'dictate';
  private app: Promise<string | undefined> = Promise.resolve(undefined);
  private title: Promise<string | undefined> = Promise.resolve(undefined);

  constructor(private readonly d: DictationDeps) {}

  /** Hotkey pressed. Ignored unless idle, which also swallows key auto-repeat and double-presses. */
  async keyDown(kind: 'dictate' | 'command' | 'ask' = 'dictate'): Promise<void> {
    if (this.state !== 'idle') return;
    this.kind = kind;
    this.state = 'recording';
    this.d.overlay({ state: 'listening' });
    const stt = this.d.newStt();
    this.stt = stt;
    const meter = (this.meter = new SpeechMeter());
    this.app = (this.d.activeApp?.() ?? Promise.resolve(undefined)).catch(() => undefined);
    this.title = (this.d.activeTitle?.() ?? Promise.resolve(undefined)).catch(() => undefined);
    this.starting = this.d.mic.start((c) => {
      meter.push(c);
      stt.pushAudio(c);
    });
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
    this.d.overlay(
      this.kind === 'command'
        ? { state: 'processing', message: 'Editing…' }
        : this.kind === 'ask'
          ? { state: 'processing', message: 'Thinking…' }
          : { state: 'processing' },
    );
    const t0 = this.d.now();
    const stt = this.stt;
    this.stt = null;
    try {
      await this.starting?.catch(() => undefined);
      // People release the key a beat before they finish the last word; keep the mic open briefly.
      const tail = this.d.tailMs ?? 200;
      if (tail > 0) await new Promise((r) => setTimeout(r, tail));
      await this.d.mic.stop();
      this.d.media?.end();
      if (this.cued) this.d.cue?.('stop');
      this.cued = false;
      const r = await stt!.finish();
      this.d.recordUsage?.({ audioSeconds: r.audioSeconds, dictations: 1 });
      this.d.log('stt', { ms: this.d.now() - t0, finalizeMs: r.finalizeMs, timedOut: r.timedOut });
      if (this.meter.rejects(r.text)) {
        // Noise or silence: whatever the model wrote is a hallucination.
        this.d.log('gate', { peak: Math.round(this.meter.peak * 1000), voiced: this.meter.voiced });
        return this.finish({ state: 'hidden' });
      }
      if (!r.text.trim()) return this.finish({ state: 'hidden' });
      if (this.kind === 'command') return await this.runCommand(r.text, t0);
      if (this.kind === 'ask') return await this.runAsk(r.text);
      // "Ask Flow, ..." with the normal dictation key is an Ask too, so a question never lands in the user's app.
      const spoken = this.kind === 'dictate' ? detectAsk(r.text) : null;
      if (spoken) return await this.runAsk(spoken);

      this.state = 'cleaning';
      const t1 = this.d.now();
      const appId = await this.app;
      const result = await this.d.process(r.text, appId, await this.title);
      this.d.log('cleanup', { ms: this.d.now() - t1 });

      if (result.kind === 'command') {
        if (result.command === 'delete-last') {
          if (this.lastInserted) await this.d.inserter.undoLast();
          this.lastInserted = false;
          return this.finish({ state: 'done', message: 'Removed' });
        }
        if (result.command === 'read-back') {
          const text = this.lastText || this.d.lastSaved?.() || '';
          if (!text) return this.finish({ state: 'error', message: 'Nothing to read back' });
          if (this.d.speak?.(text) === false)
            return this.finish({ state: 'error', message: 'No voice available to read it' });
          return this.finish({ state: 'done', message: 'Reading it back' });
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

  /**
   * The Ask shortcut was tapped, not held: the selected text is the question. The recording that the press started
   * is dropped, the selection is copied, and the answer is shown like any other. With nothing selected it says so.
   */
  async askSelection(): Promise<void> {
    if (this.state !== 'recording' || this.kind !== 'ask') return;
    this.state = 'transcribing';
    this.d.overlay({ state: 'processing', message: 'Thinking…' });
    const stt = this.stt;
    this.stt = null;
    try {
      await this.starting?.catch(() => undefined);
      await this.d.mic.stop();
      this.d.media?.end();
      if (this.cued) this.d.cue?.('stop');
      this.cued = false;
      stt?.finish().catch(() => undefined); // closes the socket; nothing was said
      const selection = ((await this.d.inserter.copySelection?.()) ?? '').trim();
      if (!selection)
        return this.finish({ state: 'error', message: 'Select text to ask about, or hold the shortcut and speak' });
      await this.runAsk(selection.slice(0, MAX_ASK_SELECTION));
    } catch (e) {
      await this.fail(this.state, 'Ask failed', e);
    }
  }

  /** Rewrites the user's selection by the spoken instruction and pastes the result over it. */
  private async runCommand(instruction: string, t0: number): Promise<void> {
    const appId = await this.app;
    const selection = (await this.d.inserter.copySelection?.()) ?? '';
    if (!selection.trim())
      return this.finish({ state: 'error', message: 'Select some text first' });
    this.state = 'cleaning';
    const t1 = this.d.now();
    const edited = await this.d.command?.(selection, instruction, appId);
    this.d.log('command', { ms: this.d.now() - t1 });
    if (edited == null) return this.finish({ state: 'error', message: 'Could not edit that text' });
    if (edited === selection) return this.finish({ state: 'done', message: 'No change' });
    if (edited === '') {
      // A delete request: the selection is still selected, so Backspace removes it ("undo" brings it back).
      this.state = 'inserting';
      await this.d.inserter.press('delete');
      this.lastInserted = false;
      return this.finish({ state: 'done', message: 'Deleted' });
    }
    this.state = 'inserting';
    this.lastText = edited;
    await this.d.inserter.insert(edited); // the text is still selected, so the paste replaces it
    this.lastInserted = true;
    this.d.log('insert', { total: this.d.now() - t0 });
    this.finish({ state: 'done', message: 'Edited' });
  }

  /** Answers the spoken question in the popup. Nothing is typed into the user's app. */
  private async runAsk(question: string): Promise<void> {
    this.state = 'cleaning';
    const t1 = this.d.now();
    const answer = await this.d.ask?.(question);
    this.d.log('ask', { ms: this.d.now() - t1 });
    if (answer == null) return this.finish({ state: 'error', message: 'Could not answer that' });
    this.d.showAnswer?.(question, answer);
    this.finish({ state: 'hidden' });
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
