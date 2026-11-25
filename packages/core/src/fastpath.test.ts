import { describe, expect, it } from 'vitest';
import type { CleanupClient } from './cleanup';
import { defaultConfig, type FlowConfig } from './config';
import { isClearAlready } from './fastpath';
import { processTranscript } from './pipeline';

const auto = (over: Partial<FlowConfig> = {}): FlowConfig => ({
  ...defaultConfig(),
  cleanupLevel: 'auto',
  hindiOutput: 'hinglish',
  ...over,
});

describe('isClearAlready (Auto fast path)', () => {
  it.each([
    'I will reach in ten minutes.',
    'Can you send me the report by Friday?',
    'The meeting is at 3 p.m. tomorrow.',
  ])('skips the model for clear text: %s', (text) => {
    expect(isClearAlready(text, auto(), 'casual')).toBe(true);
  });

  it.each([
    ['um I will reach in ten minutes.', 'filler'],
    ['I will I will reach soon.', 'stutter'],
    ['Meet at 8, no wait, at 7.', 'correction'],
    ['send it period', 'spoken punctuation and no capital or mark'],
    ['i will reach soon.', 'lowercase start'],
    ['I will reach soon', 'no end mark'],
    ['First buy milk. Second buy eggs.', 'list'],
    ['Email me at sam at the rate example dot com.', 'spoken symbols'],
    ['Line one.\nLine two.', 'newline'],
    ['मैं कल आऊँगा।', 'devanagari'],
    ['I will reach  soon.', 'double space'],
  ])('sends %s to the model (%s)', (text) => {
    expect(isClearAlready(text, auto(), 'casual')).toBe(false);
  });

  it('only applies to Auto, never to code tone, Devanagari output, or a misspelled dictionary term', () => {
    const clear = 'I will reach in ten minutes.';
    expect(isClearAlready(clear, auto({ cleanupLevel: 'light' }), 'casual')).toBe(false);
    expect(isClearAlready(clear, auto(), 'code')).toBe(false);
    expect(isClearAlready(clear, auto({ hindiOutput: 'devanagari' }), 'casual')).toBe(false);
    const dict = auto({ dictionary: [{ term: 'Spring Boot' }] });
    expect(isClearAlready('We use spring boot here.', dict, 'casual')).toBe(false);
    expect(isClearAlready('We use Spring Boot here.', dict, 'casual')).toBe(true);
  });

  it('makes no model call for clear Auto text, and still calls it for messy text', async () => {
    let calls = 0;
    const client: CleanupClient = { generate: async () => (calls++, 'Fixed text.') };
    const clear = await processTranscript('I will reach in ten minutes.', { config: auto(), client });
    expect(clear).toEqual({ kind: 'insert', text: 'I will reach in ten minutes.' });
    expect(calls).toBe(0);
    await processTranscript('um I will reach in ten minutes', { config: auto(), client });
    expect(calls).toBe(1);
  });
});
