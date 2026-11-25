import { spokenText, splitAnswer } from '@flow/core';
import { BrowserWindow, clipboard, ipcMain, screen } from 'electron';
import * as path from 'node:path';
import type { Point } from './overlay-position';
import { PointerGate } from './pointer-gate';
import { speak, stopSpeaking } from './speech';

// The window is larger than any card, transparent and click-through; only the card itself takes the mouse.
const WIN_W = 620;
const WIN_H = 560;
/** Half the icon's height plus a small gap: the card sits just above (or below) the round icon. */
const GAP = 28;
/** The card never gets closer than this to the edge of the screen. */
const MARGIN = 12;
/** How long the pointer may be away from both the icon and the card before the reminders close. */
const PEEK_GRACE_MS = 450;
/** The longest text taken from a card for the clipboard. */
const MAX_COPY = 100_000;

/** The reminders waiting to be cleared, for the card that opens when the pointer rests on the red icon. */
export interface ReminderHost {
  /** The queue, oldest first. */
  queue(): Array<{ id: string; text: string; when: string }>;
  done(id: string): void;
  snooze(id: string): void;
}

interface CardBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * The card that grows out of the floating icon. It shows either an answer from Ask (as big as the text
 * needs, with code in its own blocks, fading after eight seconds unless the pointer is over it or it is reading aloud)
 * or the queue of due reminders (shown while the pointer is on the red icon or the card, one at a time, cleared one
 * by one). It never takes focus, so the user keeps typing where they were, and it is always placed fully inside
 * the screen, next to the icon and never on top of it.
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
  private gate: PointerGate | null = null;
  /** Set once the user drags the card: it then stays where they dropped it until it closes. */
  private moved: Point | null = null;
  private lastPlaced = { up: true, originX: WIN_W / 2 };
  private dragFrom: Point | null = null;
  /** Where the card is inside the window, as the page last measured it. */
  private box: CardBox = { left: MARGIN, top: MARGIN, width: 372, height: 110 };

  /** `anchor` returns the centre of the floating icon, which the card grows from. */
  constructor(
    private readonly anchor: () => Point,
    private readonly reminders: ReminderHost,
  ) {
    const mine = (e: Electron.IpcMainEvent) => e.sender === this.win?.webContents;
    const isBox = (b: unknown): b is CardBox =>
      typeof b === 'object' &&
      b !== null &&
      ['left', 'top', 'width', 'height'].every((k) => Number.isFinite((b as Record<string, number>)[k]));

    // The page measures its own card whenever it changes size, so the window can be placed to fit it exactly.
    ipcMain.on('answer:rect', (e, b: unknown) => {
      if (!mine(e) || !isBox(b)) return;
      this.box = b;
      if (!this.moved) this.placeCard();
    });
    ipcMain.on('answer:copy', (e) => mine(e) && clipboard.writeText(this.answer));
    ipcMain.on('answer:copy-text', (e, text: unknown) => {
      if (mine(e) && typeof text === 'string') clipboard.writeText(text.slice(0, MAX_COPY));
    });
    ipcMain.on('answer:speak', (e) => {
      if (!mine(e)) return;
      speak(spokenText(this.answer), () => {
        if (this.win && !this.win.isDestroyed()) this.win.webContents.send('answer:speech-end');
      });
    });
    ipcMain.on('answer:stop', (e) => mine(e) && stopSpeaking());
    ipcMain.on('answer:close', (e) => mine(e) && this.close());
    ipcMain.on('answer:drag-start', (e, b: unknown) => {
      if (!mine(e) || !this.win) return;
      if (isBox(b)) this.box = b;
      const [x, y] = this.win.getPosition();
      this.dragFrom = { x: x!, y: y! };
      this.gate?.hold();
    });
    ipcMain.on('answer:drag', (e, d: { dx: number; dy: number }) => {
      if (!mine(e) || !this.win || !this.dragFrom) return;
      this.gate?.hold();
      // Offsets are from the drag start, so lag here cannot make the card drift. The card itself, not the
      // larger transparent window around it, is kept on the screen.
      const at = { x: this.dragFrom.x + d.dx, y: this.dragFrom.y + d.dy };
      const b = this.box;
      const area = screen.getDisplayNearestPoint({
        x: at.x + b.left + b.width / 2,
        y: at.y + b.top + b.height / 2,
      }).workArea;
      const x = clamp(at.x, area.x - b.left, area.x + area.width - b.left - b.width);
      const y = clamp(at.y, area.y - b.top, area.y + area.height - b.top - b.height);
      this.win.setPosition(Math.round(x), Math.round(y));
    });
    ipcMain.on('answer:drag-end', (e) => {
      if (!mine(e) || !this.win) return;
      this.gate?.release();
      if (!this.dragFrom) return;
      this.dragFrom = null;
      const [x, y] = this.win.getPosition();
      this.moved = { x: x!, y: y! };
    });
    ipcMain.on(
      'reminder:done',
      (e) => mine(e) && this.act(() => this.reminders.done(this.current)),
    );
    ipcMain.on(
      'reminder:snooze',
      (e) => mine(e) && this.act(() => this.reminders.snooze(this.current)),
    );
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
    this.moved = null; // a new answer opens by the icon again
    this.mode = 'answer';
    this.answer = answer;
    this.send({ kind: 'answer', question, answer, parts: splitAnswer(answer) });
  }

  close(): void {
    stopSpeaking();
    this.cancelHide();
    this.mode = 'none';
    this.current = '';
    this.moved = null;
    this.gate?.release();
    if (this.win && !this.win.isDestroyed()) this.win.hide();
  }

  /**
   * After the PC wakes, unlocks, or a display changes: keep the card on top and on a screen that exists, and make sure
   * the mouse setting is right.
   */
  reassert(): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    win.setAlwaysOnTop(true, 'screen-saver');
    if (win.isVisible()) {
      if (!this.moved) this.placeCard();
      else this.keepOnScreen();
    }
    this.gate?.tick();
  }

  private showQueue(): void {
    const queue = this.reminders.queue();
    if (!queue.length) {
      if (this.mode === 'reminder' && this.current) {
        this.current = '';
        this.cancelHide();
        this.win?.webContents.send('answer:fade');
      }
      return;
    }
    const first = queue[0]!;
    if (this.mode !== 'reminder') this.moved = null; // clearing one by one keeps the card where it was dropped
    this.mode = 'reminder';
    this.current = first.id;
    this.send({
      kind: 'reminder',
      question: '',
      answer: first.text,
      parts: [{ kind: 'text', text: first.text }],
      meta: queue.length > 1 ? `${first.when} · 1 of ${queue.length}` : first.when,
    });
  }

  /** Clears or snoozes the shown reminder, then shows the next one, or closes when the queue is empty. */
  private act(change: () => void): void {
    if (this.mode !== 'reminder' || !this.current) return;
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

  /** The pointer came onto the card or left it (decided from the real cursor, not from the page). */
  private pointer(inside: boolean): void {
    this.cardHover = inside;
    this.win?.webContents.send('answer:pointer', inside);
    if (inside) {
      this.cancelHide();
      if (this.mode === 'reminder' && !this.current) this.win?.webContents.send('answer:fade');
    } else {
      this.scheduleHide();
    }
  }

  private send(payload: Record<string, unknown>): void {
    const win = this.win && !this.win.isDestroyed() ? this.win : this.create();
    if (!this.moved) this.placeCard();
    void this.ready?.then(() => {
      if (win.isDestroyed()) return;
      win.webContents.send('answer:show', { ...payload, ...this.lastPlaced });
      win.showInactive();
    });
  }

  /**
   * Puts the card next to the icon (above it, or below it when that has more room), centred on it, and entirely inside
   * the screen with a margin, never on top of the icon unless the screen is too small. The window is moved so
   * that the card, as the page measured it, lands exactly there.
   */
  private placeCard(): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const at = this.anchor();
    const area = screen.getDisplayNearestPoint(at).workArea;
    const b = this.box;
    const above = at.y - GAP - area.y - MARGIN;
    const below = area.y + area.height - (at.y + GAP) - MARGIN;
    const up = above >= b.height || above >= below;
    const x = clamp(at.x - b.width / 2, area.x + MARGIN, area.x + area.width - b.width - MARGIN);
    const wanted = up ? at.y - GAP - b.height : at.y + GAP;
    const y = clamp(wanted, area.y + MARGIN, area.y + area.height - b.height - MARGIN);
    const winX = Math.round(x - b.left);
    const winY = Math.round(y - b.top);
    const [cx, cy] = win.getPosition();
    if (cx !== winX || cy !== winY) win.setPosition(winX, winY);
    const placed = { up, originX: at.x - winX };
    const turned = placed.up !== this.lastPlaced.up || Math.abs(placed.originX - this.lastPlaced.originX) > 1;
    this.lastPlaced = placed;
    // The card grows out of the icon, so the page needs to know which side the icon is on.
    if (turned && win.isVisible()) win.webContents.send('answer:origin', placed);
  }

  /** A dragged card whose screen went away or changed size is pulled back inside the nearest one. */
  private keepOnScreen(): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const [wx, wy] = win.getPosition();
    const b = this.box;
    const area = screen.getDisplayNearestPoint({ x: wx! + b.left + b.width / 2, y: wy! + b.top + b.height / 2 }).workArea;
    const x = clamp(wx!, area.x - b.left, area.x + area.width - b.left - b.width);
    const y = clamp(wy!, area.y - b.top, area.y + area.height - b.top - b.height);
    if (x !== wx || y !== wy) win.setPosition(Math.round(x), Math.round(y));
  }

  private create(): BrowserWindow {
    const win = new BrowserWindow({
      width: WIN_W,
      height: WIN_H,
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
        // Keep short renderer transitions running while another Flow window is in front.
        backgroundThrottling: false,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true, { forward: true });
    this.ready = win.loadFile(path.join(__dirname, 'answer.html'));
    this.win = win;
    this.gate = new PointerGate({
      win: () => this.win,
      area: () => ({ x: this.box.left, y: this.box.top, width: this.box.width, height: this.box.height }),
      onChange: (inside) => this.pointer(inside),
    });
    this.gate.start();
    win.once('closed', () => {
      this.gate?.stop();
      this.gate = null;
    });
    return win;
  }
}
