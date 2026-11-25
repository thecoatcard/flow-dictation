import { cpSync } from 'node:fs';

for (const f of ['settings.html', 'settings.css', 'audio.html', 'overlay.html', 'answer.html', 'audio-worklet.js'])
  cpSync(`src/${f}`, `dist/${f}`);
