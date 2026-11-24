import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function verify() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(desktop, 'dist/preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  await win.loadFile(path.join(desktop, 'dist/overlay.html'));
  const faded = () =>
    win.webContents.executeJavaScript("document.getElementById('icon').classList.contains('faded')");

  win.webContents.send('overlay:status', { state: 'idle' });
  await sleep(5300);
  if (!(await faded())) throw new Error('Idle icon did not fade after five seconds');

  win.webContents.send('overlay:status', { state: 'listening' });
  await sleep(100);
  if (await faded()) throw new Error('Listening status did not reveal the icon');

  process.stdout.write('Overlay fade and reveal verified.\n');
}

void verify().then(() => app.exit(0), (error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  app.exit(1);
});
