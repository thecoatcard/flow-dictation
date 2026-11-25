import { BrowserWindow, ipcMain, session } from 'electron';
import * as path from 'node:path';
import { level } from './level';

/** Owns the hidden renderer that records the mic and streams PCM16 chunks to us. */
export class MicCapture {
  private win: BrowserWindow | null = null;
  private onChunk: ((c: Buffer) => void) | null = null;
  /** Loudness 0..1 per 100 ms chunk, for the overlay and the Settings mic check. */
  onLevel: ((v: number) => void) | null = null;

  constructor() {
    ipcMain.on('audio:chunk', (e, buf: ArrayBuffer) => {
      if (e.sender !== this.win?.webContents) return;
      const chunk = Buffer.from(buf);
      this.onChunk?.(chunk);
      this.onLevel?.(level(chunk));
    });
    // Only our own file:// pages may use the mic, and only the mic.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
      cb(permission === 'media'),
    );
  }

  private async window(): Promise<BrowserWindow> {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.win = win;
    await win.loadFile(path.join(__dirname, 'audio.html'));
    return win;
  }

  private ack(channel: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      const done = (_e: unknown, msg?: string) => {
        ipcMain.removeListener('audio:failed', done);
        ipcMain.removeListener(channel, done);
        resolve(msg);
      };
      ipcMain.once(channel, done);
      ipcMain.once('audio:failed', done);
    });
  }

  /** Input devices as the renderer sees them. Briefly opens the mic so labels are populated. */
  async listDevices(): Promise<Array<{ id: string; label: string }>> {
    const win = await this.window();
    const got = new Promise<Array<{ id: string; label: string }>>((resolve) =>
      ipcMain.once('audio:devices', (e, list) => resolve(e.sender === win.webContents ? list : [])),
    );
    win.webContents.send('audio:list');
    return got;
  }

  /** Resolves once the mic is live; rejects with the renderer's error (e.g. permission denied). */
  async start(onChunk: (c: Buffer) => void, deviceId?: string): Promise<void> {
    const win = await this.window();
    this.onChunk = onChunk;
    const acked = this.ack('audio:started');
    win.webContents.send('audio:start', deviceId);
    const err = await acked;
    if (err) {
      this.onChunk = null;
      throw new Error(err);
    }
  }

  /** Plays the start or stop tone in the hidden audio page. Fire and forget. */
  cue(kind: 'start' | 'stop'): void {
    void this.window()
      .then((w) => w.webContents.send('audio:cue', kind))
      .catch(() => undefined);
  }

  /** Releases the mic. */
  async stop(): Promise<void> {
    if (!this.win || this.win.isDestroyed()) return;
    const acked = this.ack('audio:stopped');
    this.win.webContents.send('audio:stop');
    await acked;
    this.onChunk = null;
  }
}
