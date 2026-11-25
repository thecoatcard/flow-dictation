import { describe, expect, it } from 'vitest';
import type { CleanupClient } from './cleanup';
import { defaultConfig, migrateConfig } from './config';
import { isClearAlready } from './fastpath';
import { hasMarkup, markdownToHtml, markdownToPlain, renderMarkdown } from './format';
import { processTranscript } from './pipeline';
import { buildSystemPrompt } from './prompt';

const MD = [
  'Here is the plan for the launch:',
  '',
  '**Action items:**',
  '- Finish the **pricing page**',
  '- Email the beta users',
  '- Book the demo room',
  '',
  'After that we review feedback.',
].join('\n');

describe('markdownToPlain', () => {
  it('keeps lists and paragraphs and drops the bold symbols', () => {
    expect(markdownToPlain(MD)).toBe(
      [
        'Here is the plan for the launch:',
        '',
        'Action items:',
        '- Finish the pricing page',
        '- Email the beta users',
        '- Book the demo room',
        '',
        'After that we review feedback.',
      ].join('\n'),
    );
  });
  it('normalizes bullets and numbers, removes headings, and collapses extra blank lines', () => {
    expect(markdownToPlain('# Title\n\n\n\n* one\n• two\n1) first\n2. second')).toBe('Title\n\n- one\n- two\n1. first\n2. second');
  });
  it('leaves ordinary text alone', () => {
    expect(markdownToPlain('Just one sentence, about 2*3 and a * star.')).toBe('Just one sentence, about 2*3 and a * star.');
  });
});

describe('markdownToHtml', () => {
  it('builds paragraphs, a bullet list, a numbered list and bold', () => {
    expect(markdownToHtml(MD)).toBe(
      '<p>Here is the plan for the launch:</p><p><b>Action items:</b></p>' +
        '<ul><li>Finish the <b>pricing page</b></li><li>Email the beta users</li><li>Book the demo room</li></ul>' +
        '<p>After that we review feedback.</p>',
    );
    expect(markdownToHtml('Steps:\n1. Open it\n2. Save it')).toBe('<p>Steps:</p><ol><li>Open it</li><li>Save it</li></ol>');
  });
  it('escapes everything, so nothing dictated can become markup', () => {
    expect(markdownToHtml('Use <script>alert(1)</script> & "quotes" **now**')).toBe(
      '<p>Use &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot; <b>now</b></p>',
    );
  });
  it('keeps single line breaks inside a paragraph', () => {
    expect(markdownToHtml('line one\nline two')).toBe('<p>line one<br>line two</p>');
  });
});

describe('renderMarkdown', () => {
  it('adds HTML only when there is formatting to keep', () => {
    expect(renderMarkdown('A plain sentence.')).toEqual({ text: 'A plain sentence.' });
    expect(renderMarkdown('- a\n- b').html).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(hasMarkup('one\n\ntwo')).toBe(true);
    expect(hasMarkup('**x**')).toBe(true);
    expect(hasMarkup('a plain line')).toBe(false);
  });
});

const cfg = (over = {}) => ({ ...defaultConfig(), cleanupLevel: 'medium' as const, ...over });
const reply = (text: string): CleanupClient => ({ generate: async () => text });

describe('smart formatting in the pipeline', () => {
  it('returns plain text and rich HTML for a formatted reply', async () => {
    const out = await processTranscript(
      'we need to finish the pricing page email the beta users and book the demo room',
      { config: cfg(), client: reply('We need to:\n- Finish the **pricing page**\n- Email the beta users\n- Book the demo room') },
    );
    expect(out).toEqual({
      kind: 'insert',
      text: 'We need to:\n- Finish the pricing page\n- Email the beta users\n- Book the demo room',
      html: '<p>We need to:</p><ul><li>Finish the <b>pricing page</b></li><li>Email the beta users</li><li>Book the demo room</li></ul>',
    });
  });

  it('adds no HTML when the reply is plain, and keeps press enter', async () => {
    const out = await processTranscript('thanks see you tomorrow press enter', {
      config: cfg(),
      client: reply('Thanks, see you tomorrow.'),
    });
    expect(out).toEqual({ kind: 'insert', text: 'Thanks, see you tomorrow.', pressEnter: true });
  });

  it('formats each part around a spoken paragraph break, and keeps snippets literal', async () => {
    const out = (await processTranscript('first part new paragraph second part', {
      config: cfg(),
      client: { generate: async (_s, user) => (user.includes('first part') ? '**First** part' : 'Second part') },
    })) as { text: string; html?: string };
    expect(out.text).toBe('First part\n\nSecond part');
    expect(out.html).toBe('<p><b>First</b> part</p><br><br><p>Second part</p>');
  });

  it('does nothing special when smart formatting is off, and never in code or literal tones', async () => {
    const md = '- a\n- b';
    const off = await processTranscript('a and b', { config: cfg({ smartFormatting: false }), client: reply(md) });
    expect(off).toEqual({ kind: 'insert', text: md });
    const code = await processTranscript('a and b', { config: cfg({ defaultTone: 'code' }), client: reply(md) });
    expect(code).toEqual({ kind: 'insert', text: md });
  });
});

describe('smart formatting prompt and setting', () => {
  it('adds the formatting rules, replacing the older list and paragraph lines', () => {
    const p = buildSystemPrompt(cfg(), 'casual');
    expect(p).toContain('- Formatting: when the speech is long or has structure');
    expect(p).toContain('- Bold: use **bold** only');
    expect(p).not.toContain('If the speaker clearly enumerates items');
    expect(p).toContain('Lists, paragraphs and bold are allowed');
  });
  it('keeps the original rules when off, and for code and literal tones', () => {
    for (const p of [
      buildSystemPrompt(cfg({ smartFormatting: false }), 'casual'),
      buildSystemPrompt(cfg(), 'code'),
      buildSystemPrompt(cfg(), 'literal'),
    ]) {
      expect(p).toContain('If the speaker clearly enumerates items');
      expect(p).not.toContain('- Bold: use **bold**');
    }
  });
  it('is on by default, validated when read, and long speech skips the Auto fast path', () => {
    expect(defaultConfig().smartFormatting).toBe(true);
    expect(migrateConfig({ smartFormatting: false }).smartFormatting).toBe(false);
    expect(migrateConfig({ smartFormatting: 'no' }).smartFormatting).toBe(true);
    const auto = { ...defaultConfig(), cleanupLevel: 'auto' as const, hindiOutput: 'hinglish' as const };
    const longClear = 'The meeting is at three. We will cover pricing. Then we will plan the launch.';
    expect(isClearAlready(longClear, auto, 'casual')).toBe(false);
    expect(isClearAlready(longClear, { ...auto, smartFormatting: false }, 'casual')).toBe(true);
    expect(isClearAlready('The meeting is at three.', auto, 'casual')).toBe(true);
  });
});
