import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { addUsage, emptyUsage, monthKey, type UsageTotals } from '@flow/core';

/** usage.json: running totals per calendar month. Counts only; no audio or text. */
export class UsageStore {
  private months: Record<string, UsageTotals> = {};

  constructor(
    private readonly file: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    try {
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (typeof raw === 'object' && raw !== null) {
        for (const [k, v] of Object.entries(raw)) {
          if (typeof v === 'object' && v !== null) this.months[k] = addUsage(emptyUsage(), v);
        }
      }
    } catch {
      // missing or corrupt: start fresh
    }
  }

  current(): { month: string; totals: UsageTotals } {
    const month = monthKey(this.now());
    return { month, totals: this.months[month] ?? emptyUsage() };
  }

  add(delta: Partial<UsageTotals>): void {
    const { month, totals } = this.current();
    this.months[month] = addUsage(totals, delta);
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.months));
    renameSync(tmp, this.file);
  }
}
