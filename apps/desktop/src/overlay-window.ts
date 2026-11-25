import { BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'node:path';
import type { OverlayStatus } from './dictation';
import { clampOrigin, defaultOrigin, type Point } from './overlay-position';
import { PointerGate, type Box } from './pointer-gate';

const W = 260;
const H = 64;
const SIZE = { width: W, height: H };
const PILL_HEIGHT = 40;

export interface OverlayHost {
  mode(): 'always' | 'active';
  savedPos(): Point | null;
  savePos(p: Point | null): void;
  /** The icon was clicked (not dragged). */
  onClick(): void;
  /** How many reminders are due and waiting. While there are any, the icon is red and stays on screen. */
  pending(): number;
  /** The pointer came onto the icon or left it. */
  onHover(on: boolean): void;
}

/**
 * The floating icon. Never focusable, so pasting still goes to the user's app. The window is
 * click-through except while the pointer is over the icon itself, which can then be dragged. Where the pointer is
 * decided here from the real cursor position (see PointerGate), so the icon can always be grabbed.
 */
export class Overlay {
  private win: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;
  private hideTimer: NodeJS.Timeout | null = null;
  private dragFrom: Point | null = null;
  private pillWidth = PILL_HEIGHT;
  private gate: PointerGate | null = null;

  constructor(private readonly host: OverlayHost) {
    const mine = (e: Electron.IpcMainEvent) => e.sender === this.win?.webContents;

    // The renderer says how wide the pill is, so the part that takes the mouse matches what is drawn.
    ipcMain.on('overlay:pill', (e, width: number) => {
      if (mine(e) && Number.isFinite(width)) this.pillWidth = Math.min(W, Math.max(PILL_HEIGHT, width));
    });
    ipcMain.on('overlay:drag-start', (e) => {
      if (!mine(e) || !this.win) return;
      const [x, y] = this.win.getPosition();
      this.dragFrom = { x, y };
      this.gate?.hold();
    });
    ipcMain.on('overlay:drag', (e, d: { dx: number; dy: number }) => {
      if (!mine(e) || !this.win || !this.dragFrom) return;
      this.gate?.hold();
      // Offsets are from the drag start, so lag in this handler cannot make the icon drift.
      const p = clampOrigin(
        { x: this.dragFrom.x + d.dx, y: this.dragFrom.y + d.dy },
        SIZE,
        this.areas(),
      );
      this.win.setPosition(p.x, p.y);
    });
    // A drag can also end without the page seeing the button go up (focus taken, capture lost): the page says so.
    ipcMain.on('overlay:drag-end', (e) => {
      if (!mine(e) || !this.win) return;
      this.gate?.release();
      if (!this.dragFrom) return;
      this.dragFrom = null;
      const [x, y] = this.win.getPosition();
      this.host.savePos({ x, y });
    });
    ipcMain.on('overlay:click', (e) => mine(e) && this.host.onClick());
  }

  private lastState: OverlayStatus['state'] = 'hidden';

  /** Re-reads the waiting reminders: turns the icon red, or back to normal. Leaves a running dictation alone. */
  refreshPending(): void {
    if (this.lastState === 'hidden') this.show({ state: 'hidden' });
  }

  private areas() {
    return screen.getAllDisplays().map((d) => d.workArea);
  }

  /** The part of the window the pill covers, in window coordinates. */
  private pillBox(): Box {
    return {
      x: (W - this.pillWidth) / 2,
      y: (H - PILL_HEIGHT) / 2,
      width: this.pillWidth,
      height: PILL_HEIGHT,
    };
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
        // Keep short renderer transitions running while another Flow window is in front.
        backgroundThrottling: false,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true, { forward: true });
    this.ready = win.loadFile(path.join(__dirname, 'overlay.html'));
    this.win = win;
    this.gate = new PointerGate({
      win: () => this.win,
      area: () => this.pillBox(),
      onChange: (inside) => {
        this.host.onHover(inside);
        // A faded icon comes back when the pointer is where it was, so it can always be found and dragged.
        if (inside && !win.isDestroyed()) win.webContents.send('overlay:wake');
      },
    });
    this.gate.start();
    win.once('closed', () => {
      this.gate?.stop();
      this.gate = null;
    });
    this.place();
    return win;
  }

  /** Saved spot (kept on-screen), else bottom centre of the display with the cursor. */
  private place(): void {
    if (!this.win) return;
    const saved = this.host.savedPos();
    const p = saved
      ? clampOrigin(saved, SIZE, this.areas())
      : defaultOrigin(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea, SIZE);
    this.win.setPosition(p.x, p.y);
  }

  /**
   * After the PC wakes, unlocks, or a display changes: put the icon back on top, back on a screen that exists, and
   * make sure the mouse setting is right. Windows can drop any of these without telling the app.
   */
  reassert(): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    win.setAlwaysOnTop(true, 'screen-saver');
    if (!this.dragFrom) {
      const [x, y] = win.getPosition();
      const p = clampOrigin({ x: x!, y: y! }, SIZE, this.areas());
      if (p.x !== x || p.y !== y) win.setPosition(p.x, p.y);
    }
    this.gate?.tick();
  }

  /** Centre of the round icon on screen, where the answer popup grows out of. */
  anchor(): Point {
    let origin: Point;
    if (this.win && !this.win.isDestroyed()) {
      const [x, y] = this.win.getPosition();
      origin = { x: x!, y: y! };
    } else {
      const saved = this.host.savedPos();
      origin = saved
        ? clampOrigin(saved, SIZE, this.areas())
        : defaultOrigin(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea, SIZE);
    }
    return { x: origin.x + W / 2, y: origin.y + H / 2 };
  }

  /** Re-read the mode and saved position (after a settings change). */
  refresh(): void {
    if (this.host.mode() === 'always') {
      this.place();
      this.show({ state: 'hidden' });
    } else if (this.win && !this.win.isDestroyed()) {
      this.show({ state: 'hidden' });
    }
  }

  show(s: OverlayStatus): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.lastState = s.state;
    const resting = s.state === 'hidden';
    const always = this.host.mode() === 'always';
    const pending = resting ? this.host.pending() : 0;
    if (resting && !always && pending === 0 && !this.win) return;
    const win = this.win && !this.win.isDestroyed() ? this.win : this.create();

    void this.ready?.then(() => {
      if (win.isDestroyed()) return;
      // Waiting reminders win over the resting icon: red, with the count when there is more than one.
      const shown =
        pending > 0
          ? { state: 'reminder', message: pending > 1 ? String(pending) : '' }
          : resting && always
            ? { state: 'idle' }
            : s;
      win.webContents.send('overlay:status', shown);
      if (resting && !always && pending === 0) return win.hide();
      if (!win.isVisible()) win.showInactive();
      if (s.state === 'done' || s.state === 'error') {
        this.hideTimer = setTimeout(
          () => this.show({ state: 'hidden' }),
          s.state === 'error' ? 3500 : 1000,
        );
      }
    });
  }

  /** Mic loudness 0..1 while listening. */
  level(v: number): void {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible())
      this.win.webContents.send('overlay:level', v);
  }
}
