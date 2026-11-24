import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, Tray } from 'electron';
import { readFile, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import {
  classifyError,
  exportPersonalization,
  friendlyMessage,
  importPersonalization,
  estimateCost,
  summarizeStyle,
  GeminiCleanupClient,
  geminiLiveConnect,
  processTranscript,
  rememberApp,
  SttSession,
  type AppSettings,
} from '@flow/core';
import { activeAppId } from './active-window';
import { MicCapture } from './capture';
import { ConfigStore } from './config-store';
import { debugLog } from './debug-log';
import { Dictation } from './dictation';
import { createHotkeyHandler } from './hotkey';
import { Inserter } from './inserter';
import { Overlay } from './overlay-window';
import { checkPermissions, openPermissionSettings } from './permissions';
import { KeyVault } from './secret';
import { UsageStore } from './usage-store';

const APP_NAME = 'Flow';
const HOTKEYS = [
  { id: 'CtrlRight', label: 'Right Ctrl' },
  { id: 'AltRight', label: 'Right Alt / Option' },
  { id: 'ShiftRight', label: 'Right Shift' },
  // The Copilot key sends Win+Shift+F23; F23 is the last key of that chord.
  { id: 'F23', label: 'Copilot key (F23)' },
  { id: 'F8', label: 'F8' },
  { id: 'F9', label: 'F9' },
  { id: 'F10', label: 'F10' },
  { id: 'F11', label: 'F11' },
  { id: 'F12', label: 'F12' },
];
const DEFAULT_HOTKEY = process.platform === 'darwin' ? 'AltRight' : 'CtrlRight';
const keycodeFor = (id: string): number =>
  (UiohookKey as Record<string, number>)[HOTKEYS.some((h) => h.id === id) ? id : DEFAULT_HOTKEY];

/** Icons live in apps/desktop/assets, next to dist/ in dev and inside app.asar when packaged. */
const asset = (file: string) => path.join(__dirname, '..', 'assets', file);

let tray: Tray | null = null;
let settings: BrowserWindow | null = null;

interface Services {
  store: ConfigStore;
  vault: KeyVault;
  mic: MicCapture;
  usage: UsageStore;
}

function openSettings(): void {
  if (settings && !settings.isDestroyed()) {
    settings.show();
    settings.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 940,
    height: 700,
    minWidth: 780,
    minHeight: 560,
    show: false, // shown once painted, so there is no white flash before the dark theme applies
    title: `${APP_NAME} Settings`,
    icon: asset('icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#121417' : '#eceff2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  settings = win;
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  void win.loadFile(path.join(__dirname, 'settings.html'));
}

function createTray(dictation: Dictation): void {
  tray = new Tray(asset(process.platform === 'win32' ? 'tray.ico' : 'tray.png'));
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Copy last dictation',
        click: () => dictation.lastText && clipboard.writeText(dictation.lastText),
      },
      { label: 'Settings…', click: openSettings },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray.on('click', openSettings);
}

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

/** Dictionary terms as STT hints (capped; the cleanup prompt carries the full list). */
const vocabulary = (store: ConfigStore): string[] =>
  store
    .get()
    .dictionary.slice(0, 100)
    .map((d) => d.term);

function createDictation({ store, vault, mic, usage }: Services, overlay: Overlay): Dictation {
  const inserter = new Inserter();
  return new Dictation({
    mic: {
      start: (onChunk) => mic.start(onChunk, store.get().app.micDeviceId || undefined),
      stop: () => mic.stop(),
    },
    newStt: () =>
      new SttSession(geminiLiveConnect(vault.get(), store.get().models.stt, vocabulary(store))),
    activeApp: async () => {
      const id = await activeAppId();
      if (id && store.get().app.recentApps[0] !== id)
        store.update((c) => (c.app.recentApps = rememberApp(c.app.recentApps, id)));
      return id;
    },
    process: (transcript, appId) =>
      processTranscript(transcript, {
        config: store.get(),
        appId,
        client: new GeminiCleanupClient(vault.get(), store.get().models.cleanup, (u) =>
          usage.add(u),
        ),
        onError: (e) => debugLog('cleanup-error', { kind: classifyError(e) }),
      }),
    inserter,
    overlay: (s) => overlay.show(s),
    log: debugLog,
    now: Date.now,
    recordUsage: (u) => usage.add(u),
    describeError: friendlyMessage,
  });
}

/** Settings "debug record" button: record N seconds, show the final transcript. */
function registerDebugRecord({ store, vault, mic }: Services, dictation: Dictation): void {
  ipcMain.handle('debug:record', async (_e, seconds: number): Promise<DebugRecordResult> => {
    if (dictation.state !== 'idle') return { ok: false, error: 'Busy' };
    if (!vault.has()) return { ok: false, error: 'Add your API key first.' };
    const stt = new SttSession(
      geminiLiveConnect(vault.get(), store.get().models.stt, vocabulary(store)),
    );
    try {
      await mic.start((chunk) => stt.pushAudio(chunk), store.get().app.micDeviceId || undefined);
      await new Promise((r) => setTimeout(r, Math.min(Math.max(seconds, 1), 30) * 1000));
      await mic.stop();
      const r = await stt.finish();
      return { ok: true, text: r.text, finalizeMs: r.finalizeMs, timedOut: r.timedOut };
    } catch (err) {
      await mic.stop();
      void stt.finish().catch(() => undefined); // closes the socket opened for this attempt
      return { ok: false, error: friendlyMessage(err) };
    }
  });
}

function applyAutostart(enabled: boolean): void {
  // An unpackaged dev build would register bare electron.exe, which is wrong.
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath });
}

function registerSettings({ store, vault, mic, usage }: Services, overlay: Overlay): void {
  ipcMain.handle('usage:get', () => {
    const { month, totals } = usage.current();
    return { month, totals, cost: estimateCost(totals, store.get().app.sttUsdPerHour) };
  });
  const view = (): SettingsDto => ({
    app: { ...store.get().app, hotkey: store.get().app.hotkey || DEFAULT_HOTKEY },
    hotkeys: HOTKEYS,
    hasKey: vault.has(),
    secureStorage: vault.available,
    packaged: app.isPackaged,
  });
  ipcMain.handle('settings:get', view);
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    store.update((c) => {
      Object.assign(c.app, patch); // migrateConfig drops invalid values
      if (!HOTKEYS.some((h) => h.id === c.app.hotkey)) c.app.hotkey = '';
    });
    if (typeof patch.autostart === 'boolean') applyAutostart(store.get().app.autostart);
    if ('overlay' in patch || 'overlayPos' in patch) overlay.refresh();
    return view();
  });
  ipcMain.handle('key:set', (_e, key: unknown) => {
    if (typeof key !== 'string' || key.trim().length < 10)
      return { ok: false, error: 'That does not look like an API key.' };
    try {
      vault.set(key);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Could not save the key.' };
    }
  });
  ipcMain.handle('key:clear', () => vault.clear());
  ipcMain.handle('key:test', async () => {
    if (!vault.has()) return { ok: false, message: 'No API key saved.' };
    try {
      await new GeminiCleanupClient(vault.get(), store.get().models.cleanup).generate(
        'Reply with the single word OK.',
        'ping',
      );
      return { ok: true, message: 'Key works.' };
    } catch (e) {
      return { ok: false, message: friendlyMessage(e) };
    }
  });
  ipcMain.handle('mics:list', () => mic.listDevices());

  const personal = (): PersonalDto => {
    const c = store.get();
    return {
      dictionary: c.dictionary,
      appTones: c.appTones,
      defaultTone: c.defaultTone,
      snippets: c.snippets,
      style: c.style,
      recentApps: c.app.recentApps,
    };
  };
  ipcMain.handle('personal:get', personal);
  ipcMain.handle('personal:set', (_e, patch: Partial<PersonalDto>) => {
    store.update((c) => {
      // migrateConfig re-validates everything, so a bad patch cannot corrupt the file.
      if (patch.dictionary) c.dictionary = patch.dictionary;
      if (patch.appTones) c.appTones = patch.appTones;
      if (patch.defaultTone) c.defaultTone = patch.defaultTone;
      if (patch.snippets) c.snippets = patch.snippets;
      if (typeof patch.style === 'string') c.style = patch.style;
    });
    return personal();
  });

  // One-time call: samples are sent to Google, summarized, and never stored.
  ipcMain.handle('style:learn', async (_e, samples: unknown) => {
    if (!vault.has()) return { ok: false, error: 'Add your API key first.' };
    if (!Array.isArray(samples) || samples.some((s) => typeof s !== 'string'))
      return { ok: false, error: 'Add at least one writing sample.' };
    try {
      const client = new GeminiCleanupClient(vault.get(), store.get().models.cleanup);
      return { ok: true, style: await summarizeStyle(samples as string[], client) };
    } catch (e) {
      return { ok: false, error: classifyError(e) === 'other' ? errText(e) : friendlyMessage(e) };
    }
  });

  ipcMain.handle('personal:export', async () => {
    const r = await dialog.showSaveDialog({
      defaultPath: 'flow-personalization.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false };
    await writeFile(r.filePath, JSON.stringify(exportPersonalization(store.get()), null, 2));
    return { ok: true };
  });

  ipcMain.handle('personal:import', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    const file = r.filePaths[0];
    if (r.canceled || !file) return { ok: false };
    try {
      if ((await stat(file)).size > 1_000_000) throw new Error('File is too large.');
      const next = importPersonalization(store.get(), JSON.parse(await readFile(file, 'utf8')));
      store.update((c) => Object.assign(c, { ...next, app: c.app, models: c.models }));
      return { ok: true, personal: personal() };
    } catch (e) {
      return { ok: false, error: errText(e) };
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', openSettings);
  // Tray app: keep running when the settings window closes.
  app.on('window-all-closed', () => undefined);
  app.on('will-quit', () => uIOhook.stop());
  void app.whenReady().then(() => {
    const dir = app.getPath('userData');
    const svc: Services = {
      store: new ConfigStore(path.join(dir, 'flow-config.json')),
      vault: new KeyVault(path.join(dir, 'api-key.bin')),
      mic: new MicCapture(),
      usage: new UsageStore(path.join(dir, 'usage.json')),
    };
    const overlay = new Overlay({
      mode: () => svc.store.get().app.overlay,
      savedPos: () => svc.store.get().app.overlayPos,
      savePos: (p) => svc.store.update((c) => (c.app.overlayPos = p)),
      onClick: openSettings,
    });
    svc.mic.onLevel = (v) => {
      overlay.level(v);
      if (settings && !settings.isDestroyed()) settings.webContents.send('mic:level', v);
    };
    const dictation = createDictation(svc, overlay);
    registerDebugRecord(svc, dictation);
    registerSettings(svc, overlay);
    ipcMain.handle('permissions:check', () => checkPermissions());
    ipcMain.on('permissions:open', (_e, name: string) => openPermissionSettings(name));

    const hotkey = createHotkeyHandler(
      {
        get state() {
          return dictation.state;
        },
        keyUp: () => dictation.keyUp(),
        keyDown: async () => {
          if (!svc.vault.has()) {
            overlay.show({ state: 'error', message: 'Add your API key in Settings' });
            return openSettings();
          }
          return dictation.keyDown();
        },
      },
      () => svc.store.get().app.mode,
      () => keycodeFor(svc.store.get().app.hotkey),
    );
    uIOhook.on('keydown', (e) => hotkey.down(e.keycode));
    uIOhook.on('keyup', (e) => hotkey.up(e.keycode));
    uIOhook.start();

    createTray(dictation);
    overlay.refresh(); // briefly shows the idle icon; the renderer fades it after inactivity
    if (!svc.vault.has()) openSettings(); // first run: go straight to setup
  });
}
