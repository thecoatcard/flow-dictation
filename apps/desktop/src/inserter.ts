import { clipboard, type NativeImage } from 'electron';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import type { KeyAction } from './dictation';

const MOD = process.platform === 'darwin' ? UiohookKey.Meta : UiohookKey.Ctrl;
/** Time for the target app to read the clipboard before we put the old contents back. */
const RESTORE_DELAY_MS = 250;
/** "Delete that" only undoes an insertion this recent; older ones are probably not the last edit. */
const UNDO_WINDOW_MS = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ClipboardSnapshot {
  text: string;
  html: string;
  rtf: string;
  image: NativeImage;
}

function snapshot(): ClipboardSnapshot {
  return {
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    rtf: clipboard.readRTF(),
    image: clipboard.readImage(),
  };
}

function restore(s: ClipboardSnapshot): void {
  clipboard.clear();
  clipboard.write({
    ...(s.text && { text: s.text }),
    ...(s.html && { html: s.html }),
    ...(s.rtf && { rtf: s.rtf }),
    ...(!s.image.isEmpty() && { image: s.image }),
  });
}

/**
 * Inserts text by pasting it, then restores the previous clipboard.
 * If the paste keystroke cannot be sent, the text stays on the clipboard so the user can paste it
 * by hand (see docs/decisions.md: no simulated-typing fallback yet).
 */
export class Inserter {
  private lastInsertAt = 0;
  /** The user's real clipboard, waiting to be put back after the last paste. */
  private pending: { saved: ClipboardSnapshot; timer: NodeJS.Timeout } | null = null;

  async insert(text: string): Promise<void> {
    // A restore still waiting from the previous insert holds the user's real clipboard; keep that one.
    const saved = this.pending?.saved ?? snapshot();
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
    clipboard.writeText(text);
    try {
      uIOhook.keyTap(UiohookKey.V, [MOD]);
    } catch (e) {
      throw new Error(`paste failed; text left on clipboard (${String(e)})`);
    }
    this.lastInsertAt = Date.now();
    // Done as soon as the paste is sent. The old clipboard comes back once the app has read ours,
    // unless the user copied something meanwhile (theirs wins).
    const timer = setTimeout(() => {
      this.pending = null;
      if (clipboard.readText() === text) restore(saved);
    }, RESTORE_DELAY_MS);
    this.pending = { saved, timer };
  }

  /**
   * The selected text in the focused app ('' when nothing is selected), copied with Ctrl+C. The
   * clipboard is put back afterwards. The user is still holding the Command Mode shortcut's
   * modifiers, so they are released virtually first; otherwise the app would see Ctrl+Alt+C.
   */
  async copySelection(maxWaitMs = 480): Promise<string> {
    for (const key of [
      UiohookKey.Ctrl,
      UiohookKey.CtrlRight,
      UiohookKey.Alt,
      UiohookKey.AltRight,
      UiohookKey.Shift,
      UiohookKey.ShiftRight,
      UiohookKey.Meta,
      UiohookKey.MetaRight,
    ])
      uIOhook.keyToggle(key, 'up');
    if (this.pending) clearTimeout(this.pending.timer);
    const saved = this.pending?.saved ?? snapshot();
    this.pending = null;
    const marker = `flow-copy-${Date.now()}`;
    clipboard.writeText(marker);
    uIOhook.keyTap(UiohookKey.C, [MOD]);
    let text = '';
    for (let i = 0; i < Math.ceil(maxWaitMs / 40) && !text; i++) {
      await sleep(40);
      const now = clipboard.readText();
      if (now !== marker) text = now;
    }
    restore(saved);
    return text;
  }

  /** Presses a key or shortcut in the focused app, for spoken commands like "press enter". */
  async press(key: KeyAction): Promise<void> {
    switch (key) {
      case 'enter':
        uIOhook.keyTap(UiohookKey.Enter);
        break;
      case 'tab':
        uIOhook.keyTap(UiohookKey.Tab);
        break;
      case 'escape':
        uIOhook.keyTap(UiohookKey.Escape);
        break;
      case 'select-all':
        uIOhook.keyTap(UiohookKey.A, [MOD]);
        break;
      case 'undo':
        uIOhook.keyTap(UiohookKey.Z, [MOD]);
        break;
      case 'delete':
        uIOhook.keyTap(UiohookKey.Backspace);
        break;
    }
  }

  async undoLast(): Promise<void> {
    if (Date.now() - this.lastInsertAt > UNDO_WINDOW_MS) return;
    uIOhook.keyTap(UiohookKey.Z, [MOD]);
    this.lastInsertAt = 0;
  }
}
