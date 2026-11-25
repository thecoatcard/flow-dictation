import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

export interface HistoryEntry {
  id: string;
  /** ISO time of the dictation. */
  at: string;
  /** Normalized id of the app dictated into, or ''. */
  app: string;
  /** The final text that was inserted. */
  text: string;
}

export const MAX_HISTORY = 300;

/**
 * history.json: the final text of recent dictations, newest first, kept only on this PC.
 * Turned off with the "Keep dictation history" setting; "Clear all" empties it.
 */
export class HistoryStore {
  private items: HistoryEntry[] = [];

  constructor(
    private readonly file: string,
    private readonly now: () => Date = () => new Date(),
    private readonly makeId: () => string = randomUUID,
  ) {
    try {
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(raw)) {
        for (const e of raw) {
          if (
            typeof e === 'object' &&
            e !== null &&
            typeof (e as HistoryEntry).id === 'string' &&
            typeof (e as HistoryEntry).at === 'string' &&
            typeof (e as HistoryEntry).text === 'string'
          ) {
            const { id, at, text, app } = e as HistoryEntry;
            this.items.push({ id, at, text, app: typeof app === 'string' ? app : '' });
          }
        }
        this.items = this.items.slice(0, MAX_HISTORY);
      }
    } catch {
      // missing or corrupt: start empty
    }
  }

  add(text: string, app = ''): void {
    if (!text.trim()) return;
    this.items.unshift({ id: this.makeId(), at: this.now().toISOString(), app, text });
    this.items = this.items.slice(0, MAX_HISTORY);
    this.save();
  }

  /** Newest first. The query matches the text or the app, ignoring case. */
  list(query = ''): HistoryEntry[] {
    const q = query.trim().toLowerCase();
    if (!q) return [...this.items];
    return this.items.filter((e) => e.text.toLowerCase().includes(q) || e.app.includes(q));
  }

  get(id: string): HistoryEntry | undefined {
    return this.items.find((e) => e.id === id);
  }

  remove(id: string): void {
    this.items = this.items.filter((e) => e.id !== id);
    this.save();
  }

  clear(): void {
    this.items = [];
    this.save();
  }

  private save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.items));
    renameSync(tmp, this.file);
  }
}
