import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { type FlowConfig, defaultConfig, migrateConfig } from '@flow/core';

/** flow-config.json in userData. Always loads through migrateConfig, so a bad file means defaults. */
export class ConfigStore {
  private cfg: FlowConfig;

  constructor(private readonly file: string) {
    try {
      this.cfg = migrateConfig(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      this.cfg = defaultConfig();
    }
  }

  get(): FlowConfig {
    return this.cfg;
  }

  /** Applies a change, re-validates it, and writes atomically (temp file + rename). */
  update(change: (c: FlowConfig) => void): FlowConfig {
    const next = structuredClone(this.cfg);
    change(next);
    this.cfg = migrateConfig(next);
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.cfg, null, 2));
    renameSync(tmp, this.file);
    return this.cfg;
  }
}
