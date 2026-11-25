import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { emptyMemory, migrateMemory, type MemoryData } from '@flow/core';

/**
 * memory.json: the notes and reminders Ask saved, kept only on this PC. Everything read from disk goes
 * through migrateMemory, so a damaged file means an empty memory, never a crash.
 */
export class MemoryStore {
  private data: MemoryData = emptyMemory();
  private listeners: Array<() => void> = [];

  constructor(private readonly file: string) {
    try {
      this.data = migrateMemory(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      // missing or corrupt: start empty
    }
  }

  get(): MemoryData {
    return this.data;
  }

  /** Replaces the memory (after an add, clear, snooze or delete), saves it, and tells the listeners. */
  set(next: MemoryData): void {
    if (next === this.data) return;
    this.data = next;
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(next));
    renameSync(tmp, this.file);
    for (const l of this.listeners) l();
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }
}
