import type { LiveServerMessage } from '@google/genai';
import { describe, expect, it } from 'vitest';
import type { CleanupClient } from './cleanup';
import { defaultConfig } from './config';
import { guardOutput, stripNoiseTags } from './guard';
import { cleanupTimeoutMs, processTranscript } from './pipeline';
import { SttSession, type LiveConnect, type LiveHandlers } from './stt';

const msg = (c: LiveServerMessage['serverContent']): LiveServerMessage => ({ serverContent: c });

describe('guardOutput', () => {
  const long = 'we need to ship the release on friday and then update the docs and tell the team';
  it('keeps real speech when the model returns nothing', () => {
    expect(guardOutput(long, '')).toBe(long);
    expect(guardOutput('um', '')).toBe('');
    expect(guardOutput('uh huh', '')).toBe('');
  });
  it('falls back to the raw text when a long dictation is squeezed to a fragment', () => {
    expect(guardOutput(long, 'Ship on Friday.')).toBe(long);
    expect(guardOutput(long, 'We need to ship the release on Friday, update the docs, and tell the team.')).toContain('tell the team');
  });
  it('unwraps a code fence the model added', () => {
    expect(guardOutput('hello there', '```\nHello there.\n```')).toBe('Hello there.');
  });
});

describe('noise tags', () => {
  it('strips non-speech annotations', () => {
    expect(stripNoiseTags('[Music]')).toBe('');
    expect(stripNoiseTags('hello (inaudible) world [Applause]')).toBe('hello world');
    expect(stripNoiseTags('put [1] in the brackets')).toBe('put [1] in the brackets');
  });
  it('inserts nothing for a noise-only transcript at every level', async () => {
    const client: CleanupClient = { generate: async () => 'SHOULD NOT RUN' };
    for (const cleanupLevel of ['none', 'light', 'auto', 'medium'] as const) {
      const r = await processTranscript('[Music]', { config: { ...defaultConfig(), cleanupLevel }, client });
      expect(r).toEqual({ kind: 'insert', text: '' });
    }
  });
});

describe('cleanup timeout', () => {
  it('grows with length but is capped', () => {
    expect(cleanupTimeoutMs('hi')).toBeLessThan(cleanupTimeoutMs('x'.repeat(500)));
    expect(cleanupTimeoutMs('x'.repeat(100000))).toBe(8500);
  });
});

describe('SttSession interim handling', () => {
  function run(script: (h: LiveHandlers) => void) {
    const connect: LiveConnect = async (h) => ({
      sendRealtimeInput: (p) => {
        if (p.audioStreamEnd) setTimeout(() => script(h), 5);
      },
      close: () => undefined,
    });
    return new SttSession(connect, { quietMs: 30, emptyMs: 30 }).finish();
  }
  it('does not repeat text when the interim carries the whole transcript so far', async () => {
    const r = await run((h) => {
      h.onmessage(msg({ inputTranscription: { text: 'send the report' } }));
      h.onmessage(msg({ interimInputTranscription: { text: 'send the report tomorrow' } }));
      h.onmessage(msg({ turnComplete: true }));
    });
    expect(r.text).toBe('send the report tomorrow');
  });
  it('does not repeat text when the interim repeats the last final', async () => {
    const r = await run((h) => {
      h.onmessage(msg({ inputTranscription: { text: 'hello there' } }));
      h.onmessage(msg({ interimInputTranscription: { text: 'hello there' } }));
      h.onmessage(msg({ turnComplete: true }));
    });
    expect(r.text).toBe('hello there');
  });
  it('still appends a genuine new interim tail', async () => {
    const r = await run((h) => {
      h.onmessage(msg({ inputTranscription: { text: 'hello ' } }));
      h.onmessage(msg({ interimInputTranscription: { text: 'world' } }));
      h.onmessage(msg({ turnComplete: true }));
    });
    expect(r.text).toBe('hello world');
  });
});
