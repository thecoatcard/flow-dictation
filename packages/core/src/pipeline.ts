import type { CleanupClient } from './cleanup';
import { type FlowConfig, resolveTone } from './config';
import { classifyError } from './errors';
import { guardOutput } from './guard';
import { buildSystemPrompt, buildUserMessage } from './prompt';
import { detectCommand, joinSegments, segmentTranscript, type Command } from './segments';

export type PipelineResult =
  { kind: 'insert'; text: string } | { kind: 'command'; command: Command };

export interface PipelineOptions {
  config: FlowConfig;
  client: CleanupClient;
  appId?: string;
  /** Per-request cleanup budget; on expiry the raw text is used. */
  timeoutMs?: number;
  /** Called when cleanup failed and the raw text was used instead. */
  onError?: (e: unknown) => void;
}

async function cleanOne(text: string, system: string, o: PipelineOptions): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 2500);
  try {
    // One quick retry for transient failures; key and quota errors would only repeat.
    for (let attempt = 0; ; attempt++) {
      try {
        const out = await o.client.generate(system, buildUserMessage(text), ctl.signal);
        return guardOutput(text, out);
      } catch (e) {
        const kind = classifyError(e);
        if (attempt === 1 || ctl.signal.aborted || kind === 'bad-key' || kind === 'quota') throw e;
      }
    }
  } catch (e) {
    o.onError?.(e);
    return text.trim(); // failure policy: raw transcript beats nothing
  } finally {
    clearTimeout(timer);
  }
}

export async function processTranscript(
  transcript: string,
  o: PipelineOptions,
): Promise<PipelineResult> {
  const command = detectCommand(transcript);
  if (command) return { kind: 'command', command };

  const system = buildSystemPrompt(o.config, resolveTone(o.config, o.appId));
  const segments = segmentTranscript(transcript, o.config.snippets);
  const cleaned = await Promise.all(
    segments.map(async (s) =>
      s.kind === 'text' ? { ...s, text: await cleanOne(s.text, system, o) } : s,
    ),
  );
  return { kind: 'insert', text: joinSegments(cleaned) };
}
