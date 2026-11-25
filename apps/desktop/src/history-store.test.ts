import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HistoryStore, MAX_HISTORY } from './history-store';

const file = () => path.join(mkdtempSync(path.join(tmpdir(), 'flow-h-')), 'history.json');

describe('HistoryStore', () => {
  it('keeps newest first, persists, searches by text or app, and deletes', () => {
    const f = file();
    let n = 0;
    const s = new HistoryStore(
      f,
      () => new Date(2026, 10, 25, 9, n),
      () => `id${n++}`,
    );
    s.add('Meet at 7 pm', 'whatsapp');
    s.add('Send the report to Anand', 'outlook');
    s.add('   '); // blank text is ignored
    expect(s.list().map((e) => e.text)).toEqual(['Send the report to Anand', 'Meet at 7 pm']);
    expect(s.list('REPORT').map((e) => e.app)).toEqual(['outlook']);
    expect(s.list('whatsapp').map((e) => e.text)).toEqual(['Meet at 7 pm']);

    const reopened = new HistoryStore(f);
    expect(reopened.list()).toHaveLength(2);
    reopened.remove(reopened.list()[0]!.id);
    expect(reopened.list().map((e) => e.text)).toEqual(['Meet at 7 pm']);
    reopened.clear();
    expect(new HistoryStore(f).list()).toEqual([]);
  });

  it('caps the list at the newest entries', () => {
    const s = new HistoryStore(file());
    for (let i = 0; i < MAX_HISTORY + 5; i++) s.add(`line ${i}`);
    expect(s.list()).toHaveLength(MAX_HISTORY);
    expect(s.list()[0]!.text).toBe(`line ${MAX_HISTORY + 4}`);
  });

  it('survives a corrupt or foreign file and drops malformed entries', () => {
    const f = file();
    writeFileSync(f, 'nope');
    expect(new HistoryStore(f).list()).toEqual([]);
    writeFileSync(f, JSON.stringify([{ id: 'a', at: 'x', text: 'ok' }, { nope: true }, 5]));
    expect(new HistoryStore(f).list().map((e) => e.text)).toEqual(['ok']);
  });
});
