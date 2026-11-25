import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  powerMonitor,
  screen,
  Tray,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import {
  classifyError,
  exportPersonalization,
  friendlyMessage,
  cleanLanguage,
  importPersonalization,
  estimateCost,
  summarizeStyle,
  editSelection,
  applyAskResult,
  askFlow,
  clearReminder,
  formatWhen,
  removeNote,
  removeReminder,
  snoozeReminder,
  learnTerms,
  GeminiCleanupClient,
  geminiLiveConnect,
  processTranscript,
  rememberApp,
  SttSession,
  type AppSettings,
} from '@flow/core';
import { activeAppId, activeWindowTitle } from './active-window';
import { MicCapture } from './capture';
import { ConfigStore } from './config-store';
import { debugLog } from './debug-log';
import { Dictation } from './dictation';
import { createHotkeyHandler, parseCombo, type Chord } from './hotkey';
import { Inserter } from './inserter';
import { AnswerWindow } from './answer-window';
import { Overlay } from './overlay-window';
import { speak, stopSpeaking } from './speech';
import { checkPermissions, openPermissionSettings } from './permissions';
import { KeyVault } from './secret';
import {
  checkForUpdatesNow,
  getUpdateStatus,
  installUpdateNow,
  onUpdateStatus,
  startAutoUpdate,
} from './updater';
import { HistoryStore } from './history-store';
import { MemoryStore } from './memory-store';
import { ReminderWatcher } from './reminder-watcher';
import { UsageStore } from './usage-store';
import { isOutputMuted, setOutputMuted } from './win-audio';

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
const KEY_CODES = UiohookKey as Record<string, number>;
const isPreset = (id: string) => HOTKEYS.some((h) => h.id === id);
/** The Command Mode combination, or a key code that never occurs when it is turned off. */
const commandChordFor = (label: string): Chord =>
  parseCombo(label, KEY_CODES)?.chord ?? { key: -1 };
/** A preset key, or a saved combination like "Ctrl+Alt+D"; anything else falls back to the default. */
const chordFor = (id: string): Chord =>
  isPreset(id)
    ? { key: KEY_CODES[id]!, ...(id === 'F23' ? { tapOnly: true } : {}) } // the Copilot key cannot be held
    : (parseCombo(id, KEY_CODES)?.chord ?? { key: KEY_CODES[DEFAULT_HOTKEY]! });

/** Icons live in apps/desktop/assets, next to dist/ in dev and inside app.asar when packaged. */
const asset = (file: string) => path.join(__dirname, '..', 'assets', file);

let tray: Tray | null = null;
let settings: BrowserWindow | null = null;

interface Services {
  store: ConfigStore;
  vault: KeyVault;
  mic: MicCapture;
  usage: UsageStore;
  history: HistoryStore;
  memory: MemoryStore;
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
      {
        label: 'Check for updates',
        click: () => {
          openSettings();
          settings?.webContents.send('settings:page', 'updates');
          void checkForUpdatesNow();
        },
      },
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

/** Mutes the PC's output while recording and restores it, only if this app did the muting. */
function ducking(enabled: () => boolean): { begin(): void; end(): void } {
  let timer: NodeJS.Timeout | undefined;
  let weMuted = false;
  return {
    begin() {
      if (!enabled() || timer || weMuted) return;
      // A moment later, so the start chime is heard before the sound goes quiet.
      timer = setTimeout(() => {
        timer = undefined;
        if (isOutputMuted() === false && setOutputMuted(true)) weMuted = true;
      }, 320);
    },
    end() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (weMuted) {
        setOutputMuted(false);
        weMuted = false;
      }
    },
  };
}

let keyTestUntil = 0;
let endMedia: (() => void) | null = null;
/** Remembers how to end the muting, so quitting Flow mid-dictation never leaves the PC silent. */
function restoreOnQuit(media: { begin(): void; end(): void }): { begin(): void; end(): void } {
  endMedia = () => media.end();
  return media;
}

function createDictation(
  { store, vault, mic, usage, history, memory }: Services,
  overlay: Overlay,
  answers: AnswerWindow,
): Dictation {
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
    command: (selection, instruction) =>
      editSelection(selection, instruction, {
        config: store.get(),
        client: new GeminiCleanupClient(vault.get(), store.get().models.cleanup, (u) =>
          usage.add(u),
        ),
        onError: (e) => debugLog('command-error', { kind: classifyError(e) }),
        onReject: (reason) => debugLog('command-reject', { reason }),
      }),
    // Ask answers a question, or saves a note, sets or cancels a reminder; what it did is shown in the card.
    ask: async (question) => {
      const now = new Date();
      const m = memory.get();
      const result = await askFlow(
        question,
        { now, notes: m.notes, reminders: m.reminders, useNotes: store.get().app.askUsesNotes },
        {
          config: store.get(),
          client: new GeminiCleanupClient(vault.get(), store.get().models.cleanup, (u) =>
            usage.add(u),
          ),
          onError: (e) => debugLog('ask-error', { kind: classifyError(e) }),
        },
      );
      if (!result) return null;
      const done = applyAskResult(m, result, now, randomUUID);
      memory.set(done.memory);
      debugLog('ask-action', { action: result.kind });
      return done.message;
    },
    showAnswer: (question, answer) => answers.show(question, answer),
    speak: (text) => speak(text),
    lastSaved: () => history.list()[0]?.text,
    activeTitle: async () => (store.get().app.useWindowContext ? activeWindowTitle() : undefined),
    process: (transcript, appId, title) =>
      processTranscript(transcript, {
        config: store.get(),
        appId,
        context: { app: appId, title },
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
    cue: (kind) => {
      if (store.get().app.soundCues) mic.cue(kind);
    },
    media: restoreOnQuit(ducking(() => store.get().app.muteWhileDictating)),
    recordHistory: (e) => {
      if (store.get().app.keepHistory) history.add(e.text, e.app);
    },
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

function registerSettings(
  { store, vault, mic, usage, history, memory }: Services,
  overlay: Overlay,
): void {
  ipcMain.handle('memory:get', () => memory.get());
  ipcMain.handle('memory:remove-note', (_e, id: unknown) => {
    if (typeof id === 'string') memory.set(removeNote(memory.get(), id));
    return memory.get();
  });
  ipcMain.handle('memory:remove-reminder', (_e, id: unknown) => {
    if (typeof id === 'string') memory.set(removeReminder(memory.get(), id));
    return memory.get();
  });
  ipcMain.handle('history:list', (_e, query: unknown) =>
    history.list(typeof query === 'string' ? query : ''),
  );
  ipcMain.handle('history:copy', (_e, id: unknown) => {
    const e = typeof id === 'string' ? history.get(id) : undefined;
    if (e) clipboard.writeText(e.text);
    return !!e;
  });
  ipcMain.handle('history:remove', (_e, id: unknown) => {
    if (typeof id === 'string') history.remove(id);
  });
  ipcMain.handle('history:clear', () => history.clear());
  // The user fixed a dictation; the new names and technical terms in the fix are offered for the dictionary.
  ipcMain.handle('history:correct', (_e, id: unknown, text: unknown) => {
    const entry = typeof id === 'string' ? history.get(id) : undefined;
    if (!entry || typeof text !== 'string' || !text.trim()) return [];
    const before = entry.text;
    history.update(entry.id, text);
    return learnTerms(
      before,
      text,
      store.get().dictionary.map((d) => d.term),
    );
  });
  ipcMain.handle('cue:test', () => {
    mic.cue('start');
    setTimeout(() => mic.cue('stop'), 700);
  });
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
      if (!isPreset(c.app.hotkey)) c.app.hotkey = parseCombo(c.app.hotkey, KEY_CODES)?.label ?? '';
      const cmd = parseCombo(c.app.commandHotkey, KEY_CODES);
      c.app.commandHotkey = cmd && cmd.label !== c.app.hotkey ? cmd.label : '';
      const ask = parseCombo(c.app.askHotkey, KEY_CODES);
      c.app.askHotkey =
        ask && ask.label !== c.app.hotkey && ask.label !== c.app.commandHotkey ? ask.label : '';
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
      cleanupLevel: c.cleanupLevel,
      hindiOutput: c.hindiOutput,
      outputLanguage: c.outputLanguage,
      smartFormatting: c.smartFormatting,
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
      if (patch.cleanupLevel) c.cleanupLevel = patch.cleanupLevel;
      if (patch.hindiOutput) c.hindiOutput = patch.hindiOutput;
      if (typeof patch.outputLanguage === 'string') c.outputLanguage = cleanLanguage(patch.outputLanguage);
      if (typeof patch.smartFormatting === 'boolean') c.smartFormatting = patch.smartFormatting;
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
  app.on('will-quit', () => {
    endMedia?.();
    stopSpeaking();
    uIOhook.stop();
  });
  void app.whenReady().then(() => {
    const dir = app.getPath('userData');
    const svc: Services = {
      store: new ConfigStore(path.join(dir, 'flow-config.json')),
      vault: new KeyVault(path.join(dir, 'api-key.bin')),
      mic: new MicCapture(),
      usage: new UsageStore(path.join(dir, 'usage.json')),
      history: new HistoryStore(path.join(dir, 'history.json')),
      memory: new MemoryStore(path.join(dir, 'memory.json')),
    };
    // Reminders that are due form a queue: the floating icon turns red, and hovering it shows them one by one.
    const watcher: ReminderWatcher = new ReminderWatcher(
      () => svc.memory.get(),
      () => new Date(),
      (fresh) => {
        debugLog('reminder-due', { count: fresh.length });
        if (svc.store.get().app.soundCues) svc.mic.cue('start');
        overlay.refreshPending();
      },
    );
    const overlay = new Overlay({
      mode: () => svc.store.get().app.overlay,
      savedPos: () => svc.store.get().app.overlayPos,
      savePos: (p) => svc.store.update((c) => (c.app.overlayPos = p)),
      onClick: openSettings,
      pending: () => watcher.due().length,
      onHover: (on) => answers.peek(on),
    });
    svc.mic.onLevel = (v) => {
      overlay.level(v);
      if (settings && !settings.isDestroyed()) settings.webContents.send('mic:level', v);
    };
    // People who already use Flow do not need the first-run guide.
    if (
      !svc.store.get().app.guideDismissed &&
      (svc.history.list().length > 0 || svc.usage.current().totals.dictations > 0)
    )
      svc.store.update((c) => (c.app.guideDismissed = true));
    svc.mic.warm();
    const answers = new AnswerWindow(() => overlay.anchor(), {
      queue: () =>
        watcher.due().map((r) => ({
          id: r.id,
          text: r.text,
          when: formatWhen(new Date(r.snoozedUntil ?? r.due), new Date()),
        })),
      done: (id) => svc.memory.set(clearReminder(svc.memory.get(), id, new Date())),
      snooze: (id) => svc.memory.set(snoozeReminder(svc.memory.get(), id, new Date(), 10)),
    });
    const dictation = createDictation(svc, overlay, answers);
    svc.memory.onChange(() => {
      watcher.check();
      overlay.refreshPending();
      answers.refreshQueue();
    });
    // Windows can drop a floating window's z-order, mouse setting or screen without telling the app; set them right
    // again whenever the PC wakes, unlocks, or a display is added, removed or resized.
    const reassert = () => {
      overlay.reassert();
      answers.reassert();
    };
    powerMonitor.on('resume', () => {
      watcher.check();
      reassert();
    });
    powerMonitor.on('unlock-screen', reassert);
    screen.on('display-added', reassert);
    screen.on('display-removed', reassert);
    screen.on('display-metrics-changed', reassert);
    watcher.start();
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
      () => chordFor(svc.store.get().app.hotkey),
    );
    // Command Mode: hold the shortcut, say what to do, and the selected text is rewritten.
    const commandKey = createHotkeyHandler(
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
          return dictation.keyDown('command');
        },
      },
      () => 'hold',
      () => commandChordFor(svc.store.get().app.commandHotkey),
      Date.now,
      { latch: false },
    );
    // Ask: press the shortcut with text selected and that text is the question; with nothing selected, hold it and
    // ask by voice. The answer appears in a popup.
    const askKey = createHotkeyHandler(
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
          return dictation.keyDown('ask');
        },
      },
      () => 'hold',
      () => commandChordFor(svc.store.get().app.askHotkey),
      Date.now,
      { latch: false },
    );
    // "Test my key": for a few seconds after the user asks, report only the dictation hotkey's own
    // press and release timing to the Settings window, so it can tell whether the key can be held.
    const reportKey = (code: number, type: 'down' | 'up') => {
      if (Date.now() > keyTestUntil || code !== chordFor(svc.store.get().app.hotkey).key) return;
      if (settings && !settings.isDestroyed())
        settings.webContents.send('keytest:event', { type, at: Date.now() });
    };
    ipcMain.handle('keytest:start', () => {
      keyTestUntil = Date.now() + 20_000;
    });
    uIOhook.on('keydown', (e) => {
      reportKey(e.keycode, 'down');
      const mods = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
      hotkey.down(e.keycode, mods);
      commandKey.down(e.keycode, mods);
      askKey.down(e.keycode, mods);
    });
    uIOhook.on('keyup', (e) => {
      reportKey(e.keycode, 'up');
      hotkey.up(e.keycode);
      commandKey.up(e.keycode);
      askKey.up(e.keycode);
    });
    uIOhook.start();

    ipcMain.handle('update:get', () => getUpdateStatus());
    ipcMain.handle('update:check', () => checkForUpdatesNow());
    ipcMain.handle('update:install', () => installUpdateNow());
    onUpdateStatus((s) => {
      if (settings && !settings.isDestroyed()) settings.webContents.send('update:status', s);
    });
    createTray(dictation);
    startAutoUpdate();
    overlay.refresh(); // briefly shows the idle icon; the renderer fades it after inactivity
    if (!svc.vault.has()) openSettings(); // first run: go straight to setup
  });
}
