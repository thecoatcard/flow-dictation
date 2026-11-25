import { describe, expect, it } from 'vitest';
import { buildAskPrompt, MAX_ANSWER_CHARS, parseAskReply } from './ask';
import { defaultConfig } from './config';
import { spokenText, splitAnswer } from './format';

const fence = '`'.repeat(3);
const TWO_SUM = [
  'Use a hash map to find the pair in one pass.',
  `${fence}python`,
  'def two_sum(nums, target):',
  '    seen = {}',
  '    for i, n in enumerate(nums):',
  '        if target - n in seen:',
  '            return [seen[target - n], i]',
  '        seen[n] = i',
  fence,
  'Time O(n), space O(n).',
].join('\n');

const now = new Date(2026, 10, 26, 23, 50);

describe('splitAnswer', () => {
  it('separates prose and a fenced code block, keeping the language and the code exactly', () => {
    const parts = splitAnswer(TWO_SUM);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ kind: 'text', text: 'Use a hash map to find the pair in one pass.' });
    expect(parts[1]).toMatchObject({ kind: 'code', lang: 'python' });
    expect((parts[1] as { text: string }).text).toBe(
      'def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i',
    );
    expect(parts[2]).toEqual({ kind: 'text', text: 'Time O(n), space O(n).' });
  });

  it('handles several blocks, no language, code only, and plain prose', () => {
    expect(splitAnswer(`${fence}\nx = 1\n${fence}`)).toEqual([{ kind: 'code', lang: '', text: 'x = 1' }]);
    const two = splitAnswer(`A\n${fence}js\none\n${fence}\nB\n${fence}sql\ntwo\n${fence}`);
    expect(two.map((p) => p.kind)).toEqual(['text', 'code', 'text', 'code']);
    expect(splitAnswer('Just a sentence.')).toEqual([{ kind: 'text', text: 'Just a sentence.' }]);
  });

  it('treats a block that was never closed as code to the end', () => {
    const parts = splitAnswer(`Here:\n${fence}python\nprint(1)\nprint(2)`);
    expect(parts.map((p) => p.kind)).toEqual(['text', 'code']);
    expect((parts[1] as { text: string }).text).toContain('print(2)');
  });
});

describe('spokenText', () => {
  it('reads the prose and skips the code', () => {
    expect(spokenText(TWO_SUM)).toBe('Use a hash map to find the pair in one pass. Time O(n), space O(n). The code is shown on screen.');
    expect(spokenText('Canberra.')).toBe('Canberra.');
  });
});

describe('Ask answers with code', () => {
  it('shows a plain-text reply with code as the answer, braces and all', () => {
    const r = parseAskReply(TWO_SUM, now);
    expect(r).toEqual({ kind: 'answer', text: TWO_SUM });
    const json = `Config:\n${fence}json\n{"a": 1, "b": [1, 2]}\n${fence}`;
    expect(parseAskReply(json, now)).toEqual({ kind: 'answer', text: json });
  });

  it('still reads the JSON actions', () => {
    expect(parseAskReply('{"action":"remember","text":"gate code 1234"}', now)).toEqual({ kind: 'remember', text: 'gate code 1234' });
  });

  it('keeps a long solution and closes the code block if it has to cut', () => {
    const lines = Array.from({ length: 900 }, (_, i) => `    value_${i} = compute(${i})`).join('\n');
    const reply = `${fence}python\ndef big():\n${lines}\n${fence}`;
    const r = parseAskReply(reply, now) as { text: string };
    expect(r.text.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS + 8);
    expect((r.text.match(/^```/gm) ?? []).length % 2).toBe(0);
    expect(r.text.endsWith(fence)).toBe(true);
  });
});

describe('Ask prompt for coding and for how the question is asked', () => {
  const p = buildAskPrompt(defaultConfig());
  it('asks for a complete fenced solution that names the language, with a short approach and complexity', () => {
    expect(p).toContain('Coding questions');
    expect(p).toContain('"Two Sum"');
    expect(p).toContain('fenced code block that names the language');
    expect(p).toContain('time and space complexity');
    expect(p).toContain('Code never counts toward the length limit');
  });
  it('adapts the form of the answer to how it is asked', () => {
    for (const cue of ['"just the code"', '"explain"', '"step by step"', '"short"', 'Follow any preference the user states']) expect(p).toContain(cue);
  });
  it('lets a question be answered with plain text, with JSON only for the four actions', () => {
    expect(p).toContain('reply with the answer text itself and no JSON');
    for (const a of ['"remember"', '"remind"', '"cancel"', '"forget"']) expect(p).toContain(a);
  });
});
