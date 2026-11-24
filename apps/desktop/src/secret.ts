import { safeStorage } from 'electron';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

/**
 * API key at rest, encrypted with the OS keychain via safeStorage. It lives in its own file, never
 * in flow-config.json, so config export can't leak it. GEMINI_API_KEY in the environment is a
 * dev fallback only.
 */
export class KeyVault {
  constructor(private readonly file: string) {}

  get available(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  has(): boolean {
    return existsSync(this.file) || !!process.env.GEMINI_API_KEY;
  }

  get(): string {
    if (existsSync(this.file) && this.available) {
      try {
        return safeStorage.decryptString(readFileSync(this.file));
      } catch {
        // unreadable (e.g. different OS user): treat as unset
      }
    }
    return process.env.GEMINI_API_KEY ?? '';
  }

  set(key: string): void {
    if (!this.available) throw new Error('Secure storage is not available on this system.');
    writeFileSync(this.file, safeStorage.encryptString(key.trim()));
  }

  clear(): void {
    rmSync(this.file, { force: true });
  }
}
