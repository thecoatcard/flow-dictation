import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigStore } from './config-store';

const tmp = () => path.join(mkdtempSync(path.join(tmpdir(), 'flow-')), 'sub', 'flow-config.json');

describe('ConfigStore', () => {
  it('persists changes and reloads them', () => {
    const file = tmp();
    const s = new ConfigStore(file);
    s.update((c) => {
      c.app.mode = 'toggle';
      c.app.hotkey = 'F9';
    });
    const again = new ConfigStore(file);
    expect(again.get().app).toMatchObject({ mode: 'toggle', hotkey: 'F9' });
  });

  it('falls back to defaults on a corrupt file and validates updates', () => {
    const file = tmp();
    new ConfigStore(file).update(() => undefined);
    writeFileSync(file, '{not json');
    const s = new ConfigStore(file);
    expect(s.get().app.mode).toBe('hold');
    s.update((c) => {
      (c.app as { mode: string }).mode = 'bogus';
    });
    expect(JSON.parse(readFileSync(file, 'utf8')).app.mode).toBe('hold');
  });
});
