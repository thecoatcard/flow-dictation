import type { PipelineResult, SttResult } from '@flow/core';
import { describe, expect, it } from 'vitest';
import { Dictation, type DictationDeps, type OverlayStatus } from './dictation';

function setup(
  over: Partial<DictationDeps> = {},
  stt: Partial<SttResult> | Error = { text: 'hello' },
) {
  const calls: string[] = [];
  const overlays: OverlayStatus[] = [];
  let micOn = false;
  const deps: DictationDeps = {
    mic: {
      start: async () => {
        micOn = true;
        calls.push('mic.start');
      },
      stop: async () => {
        micOn = false;
        calls.push('mic.stop');
      },
    },
    newStt: () => ({
      pushAudio: () => undefined,
      finish: async () => {
        if (stt instanceof Error) throw stt;
        return { text: '', finalizeMs: 1, audioSeconds: 0, timedOut: false, ...stt };
      },
    }),
    process: async (t): Promise<PipelineResult> => ({ kind: 'insert', text: `Clean: ${t}` }),
    inserter: {
      insert: async (t) => void calls.push(`insert:${t}`),
      undoLast: async () => void calls.push('undo'),
      press: async (k) => void calls.push(`press:${k}`),
    },
    overlay: (s) => overlays.push(s),
    log: () => undefined,
    now: () => 0,
    ...over,
  };
  return { d: new Dictation(deps), calls, overlays, micOn: () => micOn };
}

describe('Dictation', () => {
  it('runs the full pipeline and returns to idle', async () => {
    const { d, calls, overlays, micOn } = setup();
    await d.keyDown();
    expect(d.state).toBe('recording');
    await d.keyUp();
    expect(calls).toEqual(['mic.start', 'mic.stop', 'insert:Clean: hello']);
    expect(micOn()).toBe(false);
    expect(d.state).toBe('idle');
    expect(d.lastText).toBe('Clean: hello');
    expect(overlays.map((o) => o.state)).toEqual(['listening', 'processing', 'done']);
  });

  it('ignores repeated keydowns and a second press while busy', async () => {
    const { d, calls } = setup();
    await d.keyDown();
    await d.keyDown();
    await d.keyDown();
    expect(calls.filter((c) => c === 'mic.start')).toHaveLength(1);
    await d.keyUp();
    await d.keyUp(); // stray second release
    expect(calls.filter((c) => c.startsWith('insert'))).toHaveLength(1);
  });

  it('silence inserts nothing and hides the overlay', async () => {
    const { d, calls, overlays } = setup({}, { text: '  ' });
    await d.keyDown();
    await d.keyUp();
    expect(calls.some((c) => c.startsWith('insert'))).toBe(false);
    expect(overlays.at(-1)).toEqual({ state: 'hidden' });
    expect(d.state).toBe('idle');
  });

  it('STT failure shows an error, inserts nothing, releases the mic', async () => {
    const { d, calls, overlays, micOn } = setup({}, new Error('quota'));
    await d.keyDown();
    await d.keyUp();
    expect(calls.some((c) => c.startsWith('insert'))).toBe(false);
    expect(overlays.at(-1)?.state).toBe('error');
    expect(micOn()).toBe(false);
    expect(d.state).toBe('idle');
  });

  it('mic failure at start shows an error and recovers', async () => {
    const { d, overlays } = setup({
      mic: {
        start: async () => Promise.reject(new Error('no device')),
        stop: async () => undefined,
      },
    });
    await d.keyDown();
    expect(overlays.at(-1)?.state).toBe('error');
    expect(d.state).toBe('idle');
    await d.keyDown(); // can try again
    expect(d.state).toBe('idle'); // failed again, but not stuck
  });

  it('keeps the text for "copy last" when insertion fails', async () => {
    const { d, overlays } = setup({
      inserter: {
        insert: async () => Promise.reject(new Error('paste')),
        undoLast: async () => undefined,
        press: async () => undefined,
      },
    });
    await d.keyDown();
    await d.keyUp();
    expect(d.lastText).toBe('Clean: hello');
    expect(overlays.at(-1)?.state).toBe('error');
  });

  it('"delete that" undoes only after a prior insertion', async () => {
    let n = 0;
    const { d, calls } = setup({
      process: async (t): Promise<PipelineResult> =>
        n++ === 0 ? { kind: 'command', command: 'delete-last' } : { kind: 'insert', text: t },
    });
    const say = async () => {
      await d.keyDown();
      await d.keyUp();
    };
    await say(); // command with nothing inserted yet
    expect(calls).not.toContain('undo');
    await say(); // inserts
    n = 0;
    await say(); // command now has something to undo
    expect(calls.filter((c) => c === 'undo')).toHaveLength(1);
  });
  it('plays the start tone once the mic is live, then mutes; unmutes and plays the stop tone after the mic is off', async () => {
    const order: string[] = [];
    const { d } = setup({
      cue: (k) => order.push(`cue:${k}`),
      media: { begin: () => order.push('mute'), end: () => order.push('unmute') },
      mic: {
        start: async () => void order.push('mic.start'),
        stop: async () => void order.push('mic.stop'),
      },
    });
    await d.keyDown();
    await d.keyUp();
    expect(order).toEqual(['mic.start', 'cue:start', 'mute', 'mic.stop', 'unmute', 'cue:stop']);
  });

  it('does not mute or play tones when the mic fails to start', async () => {
    const order: string[] = [];
    const { d } = setup({
      media: { begin: () => order.push('mute'), end: () => order.push('unmute') },
      mic: {
        start: async () => Promise.reject(new Error('no mic')),
        stop: async () => undefined,
      },
    });
    await d.keyDown();
    expect(order).toEqual(['unmute']); // never muted, and never a tone for a recording that did not start
  });

  it('spoken key commands press the key and show a label', async () => {
    let command: 'select-all' | 'press-enter' = 'select-all';
    const { d, calls, overlays } = setup({
      process: async (): Promise<PipelineResult> => ({ kind: 'command', command }),
    });
    await d.keyDown();
    await d.keyUp();
    command = 'press-enter';
    await d.keyDown();
    await d.keyUp();
    expect(calls.filter((c) => c.startsWith('press:'))).toEqual([
      'press:select-all',
      'press:enter',
    ]);
    expect(
      overlays.filter((o) => o.state === 'done').map((o) => (o as { message?: string }).message),
    ).toEqual(['Selected all', 'Enter']);
  });

  it('"press enter" after dictated text inserts the text and then presses Enter', async () => {
    const { d, calls } = setup({
      process: async (t): Promise<PipelineResult> => ({
        kind: 'insert',
        text: t,
        pressEnter: true,
      }),
    });
    await d.keyDown();
    await d.keyUp();
    expect(calls).toEqual(['mic.start', 'mic.stop', 'insert:hello', 'press:enter']);
  });
});
