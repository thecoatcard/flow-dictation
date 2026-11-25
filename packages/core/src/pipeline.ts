import type { CleanupClient } from './cleanup';
import { repairSentenceBoundary, resolveTimeBacktrack } from './backtrack';
import { type FlowConfig, resolveTone } from './config';
import { classifyError } from './errors';
import { isClearAlready } from './fastpath';
import { guardOutput, stripNoiseTags } from './guard';
import {
  buildSystemPrompt,
  buildUserMessage,
  TRANSLITERATE_PROMPT,
  type PromptContext,
} from './prompt';
import {
  detectCommand,
  joinSegments,
  segmentTranscript,
  splitTrailingEnter,
  type Command,
} from './segments';

export type PipelineResult =
  { kind: 'insert'; text: string; pressEnter?: boolean } | { kind: 'command'; command: Command };

export interface PipelineOptions {
  config: FlowConfig;
  client: CleanupClient;
  appId?: string;
  /** The focused app and its window title, used only to spell names. */
  context?: PromptContext;
  /** Per-request cleanup budget; on expiry the raw text is used. */
  timeoutMs?: number;
  /** Called when cleanup failed and the raw text was used instead. */
  onError?: (e: unknown) => void;
}

const DEVANAGARI = /[ऀ-ॿ]/;

/** Output is about as long as the input, so a long dictation needs longer than a short one: 2.5 s plus 4 ms per character, capped. */
export function cleanupTimeoutMs(text: string): number {
  return 2500 + Math.min(6000, text.length * 4);
}

async function cleanOne(text: string, system: string, o: PipelineOptions): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? cleanupTimeoutMs(text));
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
  transcript = stripNoiseTags(transcript);
  const command = detectCommand(transcript);
  if (command) return { kind: 'command', command };

  // A trailing "press enter" is not dictated text; Enter is pressed after the text is inserted.
  const { text: spoken, enter } = splitTrailingEnter(transcript);
  const inserted = (text: string): PipelineResult =>
    enter ? { kind: 'insert', text, pressEnter: true } : { kind: 'insert', text };

  // Translating needs the model even when cleanup is None, so that case runs at Light.
  const config: FlowConfig =
    o.config.cleanupLevel === 'none' && o.config.outputLanguage
      ? { ...o.config, cleanupLevel: 'light' }
      : o.config;
  const text =
    config.cleanupLevel === 'none' ? spoken : repairSentenceBoundary(resolveTimeBacktrack(spoken));
  const segments = segmentTranscript(text, config.snippets);
  if (config.cleanupLevel === 'none') {
    // None skips the editing model, but Hindi must still come out in Roman letters when asked.
    const wantsRoman = o.config.hindiOutput === 'hinglish';
    const romanized = await Promise.all(
      segments.map(async (s) =>
        wantsRoman && s.kind === 'text' && DEVANAGARI.test(s.text)
          ? { ...s, text: await cleanOne(s.text, TRANSLITERATE_PROMPT, o) }
          : s,
      ),
    );
    return inserted(joinSegments(romanized).trim());
  }
  const tone = resolveTone(config, o.appId);
  const system = buildSystemPrompt(config, tone, o.context);
  const cleaned = await Promise.all(
    segments.map(async (s) =>
      s.kind !== 'text' || isClearAlready(s.text, config, tone)
        ? s // snippets, and text Auto would leave unchanged, skip the model round trip
        : { ...s, text: await cleanOne(s.text, system, o) },
    ),
  );
  return inserted(joinSegments(cleaned));
}
