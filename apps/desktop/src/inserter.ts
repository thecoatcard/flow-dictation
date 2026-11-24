import { clipboard, type NativeImage } from 'electron';
import { uIOhook, UiohookKey } from 'uiohook-napi';

const MOD = process.platform === 'darwin' ? UiohookKey.Meta : UiohookKey.Ctrl;
/** Time for the target app to read the clipboard before we put the old contents back. */
const RESTORE_DELAY_MS = 250;
/** "Delete that" only undoes an insertion this recent; older ones are probably not the last edit. */
const UNDO_WINDOW_MS = 60_000;

interface ClipboardSnapshot {
  text: string;
  html: string;
  rtf: string;
  image: NativeImage;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  async insert(text: string): Promise<void> {
    const saved = snapshot();
    clipboard.writeText(text);
    try {
      uIOhook.keyTap(UiohookKey.V, [MOD]);
    } catch (e) {
      throw new Error(`paste failed; text left on clipboard (${String(e)})`);
    }
    await sleep(RESTORE_DELAY_MS);
    // If the user copied something meanwhile, theirs wins.
    if (clipboard.readText() === text) restore(saved);
    this.lastInsertAt = Date.now();
  }

  async undoLast(): Promise<void> {
    if (Date.now() - this.lastInsertAt > UNDO_WINDOW_MS) return;
    uIOhook.keyTap(UiohookKey.Z, [MOD]);
    this.lastInsertAt = 0;
  }
}
