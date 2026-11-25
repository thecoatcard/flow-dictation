import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const phase = process.argv[2] ?? 'after';
const build = path.join(process.env.FLOW_UI_BUILD || desktop, 'dist');
app.on('window-all-closed', () => {});
const out = path.resolve(desktop, '../../ui-review', phase);
app.setPath('userData', path.join(os.tmpdir(), `flow-ui-capture-${process.pid}`));
const pages = [
  'dictation',
  'words',
  'style',
  'usage',
  'history',
  'memory',
  'updates',
  'access',
  'backup',
];

function fixtures() {
  const appSettings = {
    hotkey: 'CtrlRight',
    mode: 'hold',
    micDeviceId: '',
    autostart: true,
    sttUsdPerHour: 0.16,
    keepHistory: true,
    commandHotkey: 'Ctrl+Alt+C',
    askHotkey: 'Ctrl+Alt+A',
    askUsesNotes: true,
    guideDismissed: true,
    keyTested: false,
    micChecked: false,
    tipsSeen: false,
    useWindowContext: true,
    soundCues: true,
    muteWhileDictating: false,
    overlay: 'always',
    overlayPos: null,
  };
  const settings = () => ({
    app: appSettings,
    hotkeys: [{ id: 'CtrlRight', label: 'Right Ctrl' }],
    hasKey: !appSettings.guideDismissed ? false : true,
    secureStorage: true,
    packaged: true,
  });
  const personal = {
    dictionary: [{ term: 'Spring Boot', hint: 'Java framework' }],
    appTones: { 'Visual Studio Code': 'code' },
    defaultTone: 'casual',
    cleanupLevel: 'auto',
    hindiOutput: 'hinglish',
    outputLanguage: '',
    snippets: [{ trigger: 'my email', expansion: 'sam@example.com' }],
    style: 'Keep sentences short. Prefer plain language.',
    recentApps: ['Visual Studio Code'],
  };
  const history = [
    {
      id: '1',
      at: '2026-11-25T08:15:00Z',
      app: 'Notepad',
      text: 'Can we move the project check-in to Friday?',
    },
    {
      id: '2',
      at: '2026-11-24T10:00:00Z',
      app: 'Visual Studio Code',
      text: 'Review the Spring Boot example before lunch.',
    },
  ];
  const handlers = {
    'settings:get': settings,
    'settings:set': (_event, patch) => (Object.assign(appSettings, patch), settings()),
    'personal:get': () => personal,
    'personal:set': (_event, patch) => Object.assign(personal, patch),
    'history:list': (_event, query) =>
      history.filter((item) => item.text.toLowerCase().includes(query.toLowerCase())),
    'history:remove': (_event, id) => {
      const index = history.findIndex((item) => item.id === id);
      if (index >= 0) history.splice(index, 1);
    },
    'history:clear': () => history.splice(0),
    'usage:get': () => ({
      month: '2026-11',
      totals: {
        dictations: appSettings.guideDismissed ? 38 : 0,
        audioSeconds: 742,
        inputTokens: 4180,
        outputTokens: 1680,
      },
      cost: { stt: 0.032, cleanup: 0.014, total: 0.046 },
    }),
    'memory:get': () => ({
      reminders: [
        {
          id: '1',
          text: 'Call Sam about the project.',
          due: '2026-11-27T10:30:00Z',
          repeat: 'none',
        },
      ],
      notes: [{ id: '2', text: 'Parked on level two.', at: '2026-11-24T10:00:00Z' }],
    }),
    'permissions:check': () => [
      { name: 'Microphone', status: 'ok', help: 'Flow can use the microphone.' },
      {
        name: 'Keyboard',
        status: 'manual',
        help: 'Check Windows settings if shortcuts do not work.',
      },
    ],
    'update:get': () => ({ state: 'uptodate', version: '0.0.22' }),
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
}

async function windowFor(file, width, height) {
  const floating = file !== 'settings.html';
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    transparent: floating,
    focusable: !floating,
    frame: false,
    webPreferences: {
      preload: path.join(build, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      offscreen: true,
    },
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`${file}: ${details.reason}`);
    app.exit(1);
  });
  await win.loadFile(path.join(build, file));
  return win;
}

const js = (win, code) => win.webContents.executeJavaScript(code);
const send = (win, channel, data) => win.webContents.send(channel, data);

async function capture(win, name, delay = 380) {
  await sleep(delay);
  const png = (await win.webContents.capturePage()).toPNG();
  assert.ok(png.length > 500, `Empty capture: ${name}`);
  await fs.writeFile(path.join(out, `${name}.png`), png);
}

async function frames(win, name, start) {
  start();
  await capture(win, `${name}-early`, 32);
  await capture(win, `${name}-middle`, 86);
  await capture(win, `${name}-settled`, 270);
}

async function captureOverlay() {
  const win = await windowFor('overlay.html', 260, 64);
  const status = (state, message) => send(win, 'overlay:status', { state, message });
  for (const [name, state, message] of [
    ['idle', 'hidden'],
    ['listening', 'listening'],
    ['processing', 'processing'],
    ['done', 'done'],
    ['error', 'error'],
    ['reminder-1', 'reminder', ''],
    ['reminder-3', 'reminder', '3'],
  ]) {
    status(state, message);
    if (state === 'listening')
      for (const level of [0.22, 0.52, 0.91, 0.45]) send(win, 'overlay:level', level);
    await capture(win, `icon-${name}`);
  }
  status('hidden');
  await sleep(360);
  await frames(win, 'motion-icon-open', () => status('listening'));
  await frames(win, 'motion-icon-process', () => status('processing'));
  await frames(win, 'motion-icon-done', () => status('done'));

  if (phase === 'after') {
    status('hidden');
    await sleep(400);
    const hit = (x) => js(win, `!!document.elementFromPoint(${x}, 32)?.closest('#icon')`);
    assert.equal(await hit(130), true);
    assert.equal(await hit(50), false);
    assert.equal(await js(win, `document.getAnimations().length`), 0, 'Idle runs no animations');
    status('listening');
    await sleep(360);
    const width = () => js(win, "document.querySelector('.pill').getBoundingClientRect().width");
    const listeningWidth = await width();
    assert.ok(listeningWidth > 80 && listeningWidth < 122, 'Listening fits its label and glyph');
    assert.equal(await hit(92), true);
    assert.equal(await hit(50), false, 'The old wide pill area is click-through');
    status('error', 'This is a longer message that needs to wrap around the icon accordingly.');
    await sleep(30);
    status('processing');
    await sleep(360);
    const workingWidth = await width();
    assert.ok(workingWidth > listeningWidth && workingWidth < 150, 'Working on it fits its label');
    assert.equal(await hit(2), false);
    status('hidden');
    await sleep(5400);
    assert.equal(await hit(130), false, 'Faded idle is click-through');

    await win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await js(win, "matchMedia('(prefers-reduced-motion: reduce)').matches").then((matches) =>
      assert.equal(matches, true),
    );
    status('listening');
    send(win, 'overlay:level', 0.9);
    await capture(win, 'reduced-icon-listening');
    assert.equal(await js(win, `document.querySelector('.g-bars rect').style.transform`), '');
    status('reminder', '3');
    await capture(win, 'reduced-icon-reminder');
    assert.equal(
      await js(win, `document.getAnimations().length`),
      0,
      'Reduced motion stops the pulse',
    );
  }
  win.destroy();
}

async function captureCards() {
  const win = await windowFor('answer.html', 420, 340);
  const show = (kind, answer, meta) =>
    send(win, 'answer:show', {
      kind,
      question: kind === 'answer' ? 'What is the answer?' : '',
      answer,
      meta,
      up: true,
      originX: 210,
    });
  await frames(win, 'motion-card-open', () => show('answer', 'The answer is 42.'));
  await capture(win, 'card-short');
  show(
    'answer',
    'Flow can answer longer questions without covering the entire screen. '.repeat(16),
  );
  await capture(win, 'card-long');
  show('reminder', 'Call Sam about the project.', 'Today, 4:00 PM');
  await capture(win, 'card-reminder-1');
  show('reminder', 'Call Sam about the project.', 'Today, 4:00 PM · 1 of 3');
  await capture(win, 'card-reminder-3');
  await frames(win, 'motion-reminder-swap', () =>
    show('reminder', 'Send the agenda.', 'Today, 4:30 PM · 1 of 2'),
  );
  // Keep the last exit frame within the visible part of the shorter fade.
  send(win, 'answer:fade');
  await capture(win, 'motion-card-close-early', 35);
  await capture(win, 'motion-card-close-middle', 75);
  if (phase === 'after') {
    await win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    show('answer', 'The answer is 42.');
    await sleep(40);
    assert.equal(
      await js(win, `getComputedStyle(document.querySelector('#card')).transform`),
      'none',
    );
    await capture(win, 'reduced-card');
  }
  win.destroy();
}

async function keyboard(win) {
  const active = () =>
    js(
      win,
      'document.activeElement.id || document.activeElement.dataset.v || document.activeElement.tagName',
    );
  const key = (name, shiftKey = false) =>
    js(
      win,
      `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(name)}, shiftKey: ${shiftKey}, bubbles: true, cancelable: true }))`,
    );
  await js(win, "document.querySelector('[data-page=style]').click()");
  await sleep(260);
  assert.equal(await active(), 'H1', 'Keyboard navigation moves focus to the new page');
  await js(win, "document.querySelector('#cleanupLevel [aria-checked=true]').focus()");
  await key('ArrowRight');
  assert.equal(await active(), 'light');
  assert.equal(
    await js(win, "document.querySelector('#cleanupLevel [aria-checked=true]').dataset.v"),
    'light',
  );
  assert.equal(
    await js(win, `document.querySelectorAll('#cleanupLevel button[tabindex="0"]').length`),
    1,
  );
  const simultaneousMotion = await js(
    win,
    `
    (() => {
      document.querySelector('[data-page=history]').click();
      const clear = document.querySelector('#histclear');
      clear.focus();
      clear.click();
      return ['#page-history', '#page-exit', '#dialog'].every(
        (selector) => document.querySelector(selector).getAnimations().length > 0
      );
    })()
  `,
  );
  assert.equal(simultaneousMotion, true, 'Page and dialog motions play together');
  assert.equal(await active(), 'dlgcancel');
  assert.equal(await js(win, "document.querySelector('.shell').inert"), true);
  await key('Tab', true);
  assert.equal(await active(), 'dlgok');
  await key('Escape');
  await sleep(250);
  assert.equal(await active(), 'histclear');
  assert.equal(await js(win, "document.querySelector('#dialog').hidden"), true);
  assert.equal(await js(win, "document.querySelector('#page-exit').hidden"), true);
  win.setSize(1240, 720);
  await sleep(80);
  assert.ok(
    await js(
      win,
      `
    (() => {
      const pane = document.querySelector('#settings-main').getBoundingClientRect();
      const page = document.querySelector('#page-history').getBoundingClientRect();
      const margin = page.left - pane.left;
      return margin > 80 && Math.abs(margin - (pane.right - page.right)) <= 1;
    })()
  `,
    ),
    'The page is centered in a wide content pane',
  );
  win.setSize(920, 720);
  await js(
    win,
    "document.querySelector('#histlist li:first-child button:last-child').focus(); document.activeElement.click()",
  );
  await sleep(350);
  assert.equal(
    await js(win, "document.querySelectorAll('#histlist li').length"),
    1,
    'History removes one row',
  );
  assert.equal(await js(win, "document.activeElement.closest('li')?.dataset.key"), '2');
}

async function captureHistorySearch(win) {
  send(win, 'settings:page', 'history');
  await sleep(350);
  const search = (q) =>
    js(
      win,
      `(() => { const input = document.querySelector('#histq'); input.focus(); input.value = ${JSON.stringify(q)}; input.dispatchEvent(new Event('input')); })();`,
    );
  await search('spring');
  await capture(win, 'history-search');
  assert.match(await js(win, "document.querySelector('#histlist').textContent"), /Spring Boot/);
  await search('unmatched');
  await capture(win, 'history-empty-search');
  assert.match(
    await js(win, "document.querySelector('#histlist').textContent"),
    /No matching|No dictations match/,
  );
}

async function captureSettings() {
  let light;
  for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme;
    const win = await windowFor('settings.html', 920, 720);
    for (const page of pages) {
      send(win, 'settings:page', page);
      await capture(win, `settings-${theme}-${page}`);
    }
    if (theme === 'light') {
      await frames(win, 'motion-settings-page', () => send(win, 'settings:page', 'usage'));
    }
    send(win, 'settings:page', 'history');
    await sleep(350);
    await js(win, "document.querySelector('#histclear').click()");
    await capture(win, `dialog-${theme}`);
    await js(win, "document.querySelector('#dlgcancel').click()");
    await sleep(250);
    send(win, 'settings:page', 'dictation');
    await sleep(100);
    await js(win, "document.querySelector('#guideshow').click()");
    await sleep(80);
    send(win, 'settings:page', 'dictation');
    await capture(win, `first-run-guide-${theme}`);
    await js(win, "document.querySelector('#guidesteps > li:last-child button').click()");
    await capture(win, `first-run-tips-${theme}`);
    await js(win, "document.querySelector('#guidehide').click()");
    await sleep(100);
    if (theme === 'light') light = win;
    else win.destroy();
  }
  nativeTheme.themeSource = 'light';
  await captureHistorySearch(light);
  if (phase === 'after') {
    await js(
      light,
      "const field = document.querySelector('#histq'); field.value = ''; field.dispatchEvent(new Event('input'))",
    );
    await keyboard(light);
  }
  light.destroy();
}

async function run() {
  await fs.mkdir(out, { recursive: true });
  await app.whenReady();
  fixtures();
  await captureOverlay();
  console.log('Overlay captured');
  await captureCards();
  console.log('Cards captured');
  await captureSettings();
  console.log('Settings captured');
}

void run().then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    app.exit(1);
  },
);
