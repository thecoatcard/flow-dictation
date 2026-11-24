import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { UsageStore } from './usage-store';

const file = () => path.join(mkdtempSync(path.join(tmpdir(), 'flow-u-')), 'usage.json');

describe('UsageStore', () => {
  it('accumulates, persists, and rolls over by month', () => {
    const f = file();
    let now = new Date(2026, 10, 30);
    const s = new UsageStore(f, () => now);
    s.add({ audioSeconds: 10, dictations: 1 });
    s.add({ inputTokens: 5 });
    expect(s.current().totals).toMatchObject({ audioSeconds: 10, inputTokens: 5, dictations: 1 });
    expect(new UsageStore(f, () => now).current().totals.audioSeconds).toBe(10);
    now = new Date(2026, 11, 1);
    expect(s.current()).toMatchObject({ month: '2026-12', totals: { audioSeconds: 0 } });
  });

  it('survives a corrupt file', () => {
    const f = file();
    writeFileSync(f, 'nope');
    expect(new UsageStore(f).current().totals.dictations).toBe(0);
  });
});
