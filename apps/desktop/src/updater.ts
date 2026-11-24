import { app, Notification } from 'electron';
import { autoUpdater } from 'electron-updater';
import { debugLog } from './debug-log';

const FIRST_CHECK_MS = 30_000; // let startup finish before touching the network
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000; // one tiny request a day; no polling

let downloaded = '';

const toast = (title: string, body: string, onClick?: () => void): void => {
  const n = new Notification({ title, body });
  if (onClick) n.on('click', onClick);
  n.show();
};

/** Looks at the latest GitHub release, downloads a newer installer quietly and installs it on quit. */
export function startAutoUpdate(): void {
  if (!app.isPackaged) return; // a dev run is not an installed build
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on('error', (e) => debugLog('update_error', { message: e.message }));
  autoUpdater.on('update-available', (i) => debugLog('update_available', { version: i.version }));
  autoUpdater.on('update-downloaded', (i) => {
    downloaded = i.version;
    debugLog('update_downloaded', { version: i.version });
    toast(
      'Flow update ready',
      `Version ${i.version} installs when you quit Flow. Click to restart and install now.`,
      () => autoUpdater.quitAndInstall(),
    );
  });
  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined);
  setTimeout(check, FIRST_CHECK_MS).unref();
  setInterval(check, CHECK_EVERY_MS).unref();
}

/** Tray action: check now and say what happened. */
export async function checkForUpdatesNow(): Promise<void> {
  if (!app.isPackaged) return toast('Flow', 'Updates work in the installed app.');
  if (downloaded)
    return toast('Flow update ready', `Version ${downloaded} installs when you quit Flow.`);
  try {
    const r = await autoUpdater.checkForUpdates();
    toast(
      'Flow',
      r?.isUpdateAvailable
        ? `Version ${r.updateInfo.version} is downloading. You will be told when it is ready.`
        : `Flow ${app.getVersion()} is up to date.`,
    );
  } catch {
    toast('Flow', 'Could not check for updates. Try again later.');
  }
}
