import { app } from 'electron';
import { appendFile } from 'node:fs/promises';
import * as path from 'node:path';

/** Error text can echo the request URL, which carries the API key. */
const redact = (s: string) =>
  s.replace(/AIza[\w-]{20,}/g, '[key]').replace(/key=[^&\s]+/gi, 'key=[key]');

/** Timings and error types only: never audio, transcripts or keys. */
export function debugLog(
  event: string,
  data: Record<string, number | string | boolean> = {},
): void {
  const clean = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? redact(v) : v]),
  );
  const line = JSON.stringify({ t: new Date().toISOString(), event, ...clean }) + '\n';
  void appendFile(path.join(app.getPath('userData'), 'flow-debug.log'), line).catch(
    () => undefined,
  );
}
