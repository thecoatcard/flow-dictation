import { BrowserWindow, clipboard, ipcMain, screen } from 'electron';
import * as path from 'node:path';
import { clampOrigin, type Point } from './overlay-position';
import { speak, stopSpeaking } from './speech';

// The window is larger than any card, transparent and click-through; only the card itself takes the mouse.
const W = 420;
const H = 340;
/** Half the icon's height plus a small gap: the card sits just above (or below) the round icon. */
const GAP = 28;
/** How long the pointer may be away from both the icon and the card before the reminders close. */
const PEEK_GRACE_MS = 450;

/** The reminders waiting to be cleared, for the card that opens when the pointer rests on the red icon. */
export interface ReminderHost {
  /** The queue, oldest first. */
  queue(): Array<{ id: string; text: string; when: string }>;
  done(id: string): void;
  snooze(id: string): void;
}

/**
 * The card that grows out of the floating icon. It shows either an answer from Ask (as big as the text
 * needs, fading after 15 seconds unless the pointer is over it or it is reading aloud) or the queue of due
 * reminders (shown while the pointer is on the red icon or the card, one at a time, cleared one by one).
 * It never takes focus, so the user keeps typing where they were.
 */
export class AnswerWindow {
  private win: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;
  private answer = '';
  private mode: 'none' | 'answer' | 'reminder' = 'none';
  private current = '';
  private iconHover = false;
  private cardHover = false;
  private hideTimer: NodeJS.Timeout | null = null;

  /** `anchor` returns the centre of the floating icon, which the card grows from. */
  constructor(
    private readonly anchor: () => Point,
    private readonly reminders: ReminderHost,
  ) {
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
    ipcMain.on('answer:hover', (e, on: boolean) => {
      if (!mine(e)) return;
      this.cardHover = on;
      if (on) this.cancelHide();
      else this.scheduleHide();
    });
    ipcMain.on('reminder:done', (e) => mine(e) && this.act(() => this.reminders.done(this.current)));
    ipcMain.on('reminder:snooze', (e) => mine(e) && this.act(() => this.reminders.snooze(this.current)));
  }

  /** The pointer entered or left the floating icon. While reminders wait, resting on it opens them. */
  peek(on: boolean): void {
    this.iconHover = on;
    if (on) {
      this.cancelHide();
      if (this.reminders.queue().length) this.showQueue();
    } else {
      this.scheduleHide();
    }
  }

  /** The queue changed (a reminder came due, or was cleared elsewhere): update the open reminder card. */
  refreshQueue(): void {
    if (this.mode === 'reminder' && this.win?.isVisible()) this.showQueue();
  }

  show(question: string, answer: string): void {
    this.mode = 'answer';
    this.answer = answer;
    this.send({ kind: 'answer', question, answer });
  }

  close(): void {
    stopSpeaking();
    this.cancelHide();
    this.mode = 'none';
    if (this.win && !this.win.isDestroyed()) this.win.hide();
  }

  private showQueue(): void {
    const queue = this.reminders.queue();
    if (!queue.length) return this.mode === 'reminder' ? this.close() : undefined;
    const first = queue[0]!;
    this.mode = 'reminder';
    this.current = first.id;
    this.send({
      kind: 'reminder',
      question: '',
      answer: first.text,
      meta: queue.length > 1 ? `${first.when} · 1 of ${queue.length}` : first.when,
    });
  }

  /** Clears or snoozes the shown reminder, then shows the next one, or closes when the queue is empty. */
  private act(change: () => void): void {
    change();
    this.showQueue();
  }

  private scheduleHide(): void {
    if (this.mode !== 'reminder') return;
    this.cancelHide();
    this.hideTimer = setTimeout(() => {
      if (this.iconHover || this.cardHover || this.mode !== 'reminder') return;
      if (this.win && !this.win.isDestroyed()) this.win.webContents.send('answer:fade');
    }, PEEK_GRACE_MS);
  }

  private cancelHide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }

  private send(payload: Record<string, unknown>): void {
    const win = this.win && !this.win.isDestroyed() ? this.win : this.create();
    const placed = this.place(win);
    void this.ready?.then(() => {
      if (win.isDestroyed()) return;
      win.webContents.send('answer:show', { ...payload, ...placed });
      win.showInactive();
    });
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
