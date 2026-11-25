import { BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'node:path';
import type { OverlayStatus } from './dictation';
import { clampOrigin, defaultOrigin, type Point } from './overlay-position';

const W = 260;
const H = 64;
const SIZE = { width: W, height: H };

export interface OverlayHost {
  mode(): 'always' | 'active';
  savedPos(): Point | null;
  savePos(p: Point | null): void;
  /** The icon was clicked (not dragged). */
  onClick(): void;
}

/**
 * The floating icon. Never focusable, so pasting still goes to the user's app. The window is
 * click-through except while the pointer is over the icon itself, which can then be dragged.
 */
export class Overlay {
  private win: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;
  private hideTimer: NodeJS.Timeout | null = null;
  private dragFrom: Point | null = null;

  constructor(private readonly host: OverlayHost) {
    const mine = (e: Electron.IpcMainEvent) => e.sender === this.win?.webContents;

    ipcMain.on('overlay:interactive', (e, on: boolean) => {
      if (mine(e)) this.win?.setIgnoreMouseEvents(!on, { forward: true });
    });
    ipcMain.on('overlay:drag-start', (e) => {
      if (!mine(e) || !this.win) return;
      const [x, y] = this.win.getPosition();
      this.dragFrom = { x, y };
    });
    ipcMain.on('overlay:drag', (e, d: { dx: number; dy: number }) => {
      if (!mine(e) || !this.win || !this.dragFrom) return;
      // Offsets are from the drag start, so lag in this handler cannot make the icon drift.
      const p = clampOrigin(
        { x: this.dragFrom.x + d.dx, y: this.dragFrom.y + d.dy },
        SIZE,
        this.areas(),
      );
      this.win.setPosition(p.x, p.y);
    });
    ipcMain.on('overlay:drag-end', (e) => {
      if (!mine(e) || !this.win || !this.dragFrom) return;
      this.dragFrom = null;
      const [x, y] = this.win.getPosition();
      this.host.savePos({ x, y });
    });
    ipcMain.on('overlay:click', (e) => mine(e) && this.host.onClick());
  }

  private areas() {
    return screen.getAllDisplays().map((d) => d.workArea);
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
    this.ready = win.loadFile(path.join(__dirname, 'overlay.html'));
    this.win = win;
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
    const resting = s.state === 'hidden';
    const always = this.host.mode() === 'always';
    if (resting && !always && !this.win) return;
    const win = this.win && !this.win.isDestroyed() ? this.win : this.create();

    void this.ready?.then(() => {
      if (win.isDestroyed()) return;
      win.webContents.send('overlay:status', resting && always ? { state: 'idle' } : s);
      if (resting && !always) return win.hide();
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
