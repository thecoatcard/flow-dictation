import { BrowserWindow, clipboard, ipcMain, screen } from 'electron';
import * as path from 'node:path';
import { speak, stopSpeaking } from './speech';

const W = 440;
const H = 260;
const MARGIN = 16;

/**
 * The answer popup for Ask: a small always-on-top card at the bottom right of the screen with the
 * question, the answer, and Copy / Read aloud / Close. It never takes focus when it appears, so
 * the user keeps typing where they were; clicking it focuses it, and Esc closes it.
 */
export class AnswerWindow {
  private win: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;
  private answer = '';

  constructor() {
    const mine = (e: Electron.IpcMainEvent) => e.sender === this.win?.webContents;
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
    void this.ready?.then(() => {
      if (win.isDestroyed()) return;
      win.webContents.send('answer:show', { question, answer });
      win.showInactive();
    });
  }

  close(): void {
    stopSpeaking();
    if (this.win && !this.win.isDestroyed()) this.win.hide();
  }

  private create(): BrowserWindow {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const win = new BrowserWindow({
      width: W,
      height: H,
      x: area.x + area.width - W - MARGIN,
      y: area.y + area.height - H - MARGIN,
      frame: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      resizable: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: true,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    this.ready = win.loadFile(path.join(__dirname, 'answer.html'));
    this.win = win;
    return win;
  }
}
