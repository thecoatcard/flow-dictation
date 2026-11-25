import { BrowserWindow, clipboard, ipcMain, screen } from 'electron';
import * as path from 'node:path';
import { clampOrigin, type Point } from './overlay-position';
import { speak, stopSpeaking } from './speech';

// The window is larger than any card, transparent and click-through; only the card itself takes the mouse.
const W = 420;
const H = 340;
/** Half the icon's height plus a small gap: the card sits just above (or below) the round icon. */
const GAP = 28;

/**
 * The answer popup for Ask. It grows out of the floating icon, is as big as its text needs, and
 * fades away after 15 seconds unless the pointer is over it or it is reading aloud. It never takes
 * focus, so the user keeps typing where they were.
 */
export class AnswerWindow {
  private win: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;
  private answer = '';

  /** `anchor` returns the centre of the floating icon, which the card grows from. */
  constructor(private readonly anchor: () => Point) {
    const mine = (e: Electron.IpcMainEvent) => e.sender === this.win?.webContents;
    ipcMain.on('answer:interactive', (e, on: boolean) => {
      if (mine(e)) this.win?.setIgnoreMouseEvents(!on, { forward: true });
    });
    ipcMain.on('answer:copy', (e) => mine(e) && clipboard.writeText(this.answer));
    ipcMain.on('answer:speak', (e) => {
      if (!mine(e)) return;
      speak(this.answer, () => {
        if (this.win && !this.win.isDestroyed()) this.win.webContents.send('answer:speech-end');
      });
    });
    ipcMain.on('answer:stop', (e) => mine(e) && stopSpeaking());
    ipcMain.on('answer:close', (e) => mine(e) && this.close());
  }

  show(question: string, answer: string): void {
    this.answer = answer;
    const win = this.win && !this.win.isDestroyed() ? this.win : this.create();
    const placed = this.place(win);
    void this.ready?.then(() => {
      if (win.isDestroyed()) return;
      win.webContents.send('answer:show', { question, answer, ...placed });
      win.showInactive();
    });
  }

  close(): void {
    stopSpeaking();
    if (this.win && !this.win.isDestroyed()) this.win.hide();
  }

  /**
   * Puts the window above the icon (below it when there is no room), centred on it and kept on screen.
   * Returns what the renderer needs to grow the card out of the icon: which edge faces it and where.
   */
  private place(win: BrowserWindow): { up: boolean; originX: number } {
    const at = this.anchor();
    const area = screen.getDisplayNearestPoint(at).workArea;
    const up = at.y - GAP - H >= area.y;
    const y = up ? at.y - GAP - H : at.y + GAP;
    const p = clampOrigin({ x: at.x - W / 2, y }, { width: W, height: H }, [area]);
    win.setPosition(p.x, p.y);
    return { up, originX: at.x - p.x };
  }

  private create(): BrowserWindow {
    const win = new BrowserWindow({
      width: W,
      height: H,
      frame: false,
      transparent: true,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      resizable: false,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: true,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true, { forward: true });
    this.ready = win.loadFile(path.join(__dirname, 'answer.html'));
    this.win = win;
    return win;
  }
}
