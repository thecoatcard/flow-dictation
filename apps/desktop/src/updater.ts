import { app, Notification } from 'electron';
import { autoUpdater } from 'electron-updater';
import { debugLog } from './debug-log';

/** What the Settings > Updates page shows. `version` is the installed version. */
export interface UpdateStatus {
  state: 'idle' | 'checking' | 'downloading' | 'ready' | 'uptodate' | 'error' | 'unavailable';
  version: string;
  latest?: string;
  percent?: number;
  message?: string;
}

const FIRST_CHECK_MS = 30_000; // let startup finish before touching the network
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000; // one tiny request a day; no polling

let status: UpdateStatus = { state: 'idle', version: app.getVersion() };
const listeners = new Set<(s: UpdateStatus) => void>();

const set = (patch: Partial<UpdateStatus>): void => {
  status = { ...status, ...patch };
  listeners.forEach((l) => l(status));
};

export const getUpdateStatus = (): UpdateStatus => status;
export const onUpdateStatus = (cb: (s: UpdateStatus) => void): void => void listeners.add(cb);

const friendly = (e: Error): string =>
  /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ERR_INTERNET|network|net::/i.test(e.message)
    ? 'Could not reach GitHub. Check your connection and try again.'
    : /404|latest\.yml|No published versions/i.test(e.message)
      ? 'No update information was found on the latest release.'
      : 'Could not check for updates. Try again later.';

/** Wires the updater to the latest GitHub release and schedules the daily check. Call once. */
export function startAutoUpdate(): void {
  if (!app.isPackaged) {
    set({ state: 'unavailable', message: 'Updates work in the installed app.' });
    return; // a dev run is not an installed build
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', message: undefined }));
  autoUpdater.on('update-available', (i) => {
    debugLog('update_available', { version: i.version });
    set({ state: 'downloading', latest: i.version, percent: 0 });
  });
  autoUpdater.on('download-progress', (p) =>
    set({ state: 'downloading', percent: Math.round(p.percent) }),
  );
  autoUpdater.on('update-not-available', () => set({ state: 'uptodate', latest: undefined }));
  autoUpdater.on('update-downloaded', (i) => {
    debugLog('update_downloaded', { version: i.version });
    set({ state: 'ready', latest: i.version, percent: 100 });
    const n = new Notification({
      title: 'Flow update ready',
      body: `Version ${i.version} installs when you quit Flow. Click to restart and install now.`,
    });
    n.on('click', installUpdateNow);
    n.show();
  });
  autoUpdater.on('error', (e) => {
    debugLog('update_error', { message: e.message });
    set({ state: 'error', message: friendly(e) });
  });
  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined);
  setTimeout(check, FIRST_CHECK_MS).unref();
  setInterval(check, CHECK_EVERY_MS).unref();
}

/** Settings and tray action. Progress is reported through the status events. */
export async function checkForUpdatesNow(): Promise<void> {
  if (!app.isPackaged || status.state === 'checking' || status.state === 'downloading') return;
  if (status.state === 'ready') return;
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    // the 'error' event has already set the status
  }
}

export function installUpdateNow(): void {
  if (status.state === 'ready') autoUpdater.quitAndInstall();
}
