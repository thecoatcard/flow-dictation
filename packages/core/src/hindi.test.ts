import { describe, expect, it } from 'vitest';
import type { CleanupClient } from './cleanup';
import { defaultConfig, migrateConfig } from './config';
import { processTranscript } from './pipeline';
import { exportPersonalization, importPersonalization } from './portability';
import { buildSystemPrompt, TRANSLITERATE_PROMPT } from './prompt';

/** Records calls and answers with a fixed string. */
function client(
  answer: string,
): CleanupClient & { calls: Array<{ system: string; user: string }> } {
  const calls: Array<{ system: string; user: string }> = [];
  return {
    calls,
    async generate(system, user) {
      calls.push({ system, user });
      return answer;
    },
  };
}

describe('Hindi output', () => {
  it('defaults to Hinglish and validates the stored value', () => {
    expect(defaultConfig().hindiOutput).toBe('hinglish');
    expect(migrateConfig({ hindiOutput: 'devanagari' }).hindiOutput).toBe('devanagari');
    expect(migrateConfig({ hindiOutput: 'klingon' }).hindiOutput).toBe('hinglish');
  });

  it('tells the model to write Hindi in Roman letters by default, and leaves other languages alone', () => {
    const p = buildSystemPrompt(defaultConfig(), 'casual');
    expect(p).toContain('write spoken Hindi in Roman letters (Hinglish)');
    expect(p).toContain('Never use Devanagari');
    expect(p).toContain('entirely English, or in another language, is written as usual');
    expect(p).not.toContain('write spoken Hindi in Devanagari');
  });

  it('writes Devanagari when the user asks for it', () => {
    const p = buildSystemPrompt({ ...defaultConfig(), hindiOutput: 'devanagari' }, 'casual');
    expect(p).toContain('write spoken Hindi in Devanagari');
    expect(p).not.toContain('Never use Devanagari');
  });

  it('with cleanup None, still converts Devanagari speech to Hinglish', async () => {
    const c = client('main kal office jaunga');
    const r = await processTranscript('मैं कल ऑफिस जाऊँगा', {
      config: { ...defaultConfig(), cleanupLevel: 'none' },
      client: c,
    });
    expect(r).toEqual({ kind: 'insert', text: 'main kal office jaunga' });
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]!.system).toBe(TRANSLITERATE_PROMPT);
  });

  it('with cleanup None, English speech never reaches the model', async () => {
    const c = client('SHOULD NOT BE USED');
    const r = await processTranscript('I will go to the office tomorrow', {
      config: { ...defaultConfig(), cleanupLevel: 'none' },
      client: c,
    });
    expect(r).toEqual({ kind: 'insert', text: 'I will go to the office tomorrow' });
    expect(c.calls).toHaveLength(0);
  });

  it('with cleanup None and Devanagari chosen, Hindi is left as spoken', async () => {
    const c = client('SHOULD NOT BE USED');
    const r = await processTranscript('मैं कल जाऊँगा', {
      config: { ...defaultConfig(), cleanupLevel: 'none', hindiOutput: 'devanagari' },
      client: c,
    });
    expect(r).toEqual({ kind: 'insert', text: 'मैं कल जाऊँगा' });
    expect(c.calls).toHaveLength(0);
  });

  it('with cleanup None, a failed conversion keeps the raw words', async () => {
    const failing: CleanupClient = {
      async generate() {
        throw new Error('boom');
      },
    };
    const r = await processTranscript('मैं कल जाऊँगा', {
      config: { ...defaultConfig(), cleanupLevel: 'none' },
      client: failing,
    });
    expect(r).toEqual({ kind: 'insert', text: 'मैं कल जाऊँगा' });
  });

  it('travels in backups', () => {
    const cfg = { ...defaultConfig(), hindiOutput: 'devanagari' as const };
    const out = exportPersonalization(cfg);
    expect(out.hindiOutput).toBe('devanagari');
    expect(importPersonalization(defaultConfig(), out).hindiOutput).toBe('devanagari');
    // An older export without the field keeps the current choice.
    const old = { ...out };
    delete old.hindiOutput;
    expect(importPersonalization(cfg, old).hindiOutput).toBe('devanagari');
  });
});
