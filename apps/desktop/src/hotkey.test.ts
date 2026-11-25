import type { Mode } from '@flow/core';
import { describe, expect, it } from 'vitest';
import { createHotkeyHandler, parseCombo, TAP_MS, type Chord } from './hotkey';

function setup(mode: Mode, chord: Chord = { key: 7 }) {
  const calls: string[] = [];
  let t = 1000;
  const d = {
    state: 'idle',
    keyDown: async () => {
      calls.push('down');
      d.state = 'recording';
    },
    keyUp: async () => {
      calls.push('up');
      d.state = 'idle';
    },
  };
  const h = createHotkeyHandler(
    d,
    () => mode,
    () => chord,
    () => t,
  );
  return { h, d, calls, wait: (ms: number) => (t += ms) };
}

describe('createHotkeyHandler', () => {
  it('hold: recording lasts while the key is down, auto-repeat and other keys are ignored', () => {
    const { h, calls, wait } = setup('hold');
    h.down(7);
    h.down(7);
    h.down(7);
    h.down(8);
    h.up(8);
    wait(TAP_MS + 400);
    h.up(7);
    expect(calls).toEqual(['down', 'up']);
  });

  it('hold: a quick tap keeps recording, and the next press stops it', () => {
    const { h, calls, wait } = setup('hold');
    h.down(7);
    wait(60); // a Copilot key reports press and release almost together
    h.up(7);
    expect(calls).toEqual(['down']);
    wait(3000); // the user talks
    h.down(7);
    h.up(7);
    expect(calls).toEqual(['down', 'up']);
  });

  it('hold: a long hold after a latched tap still works as a fresh hold', () => {
    const { h, calls, wait } = setup('hold');
    h.down(7);
    wait(50);
    h.up(7);
    h.down(7); // stops the latched recording
    wait(50);
    h.up(7);
    h.down(7); // new hold
    wait(TAP_MS + 500);
    h.up(7);
    expect(calls).toEqual(['down', 'up', 'down', 'up']);
  });

  it('hold: a latched recording that already ended starts fresh on the next press', () => {
    const { h, d, calls, wait } = setup('hold');
    h.down(7);
    wait(50);
    h.up(7);
    d.state = 'idle'; // the dictation failed or ended on its own
    h.down(7);
    wait(TAP_MS + 300);
    h.up(7);
    expect(calls).toEqual(['down', 'down', 'up']);
  });

  it('toggle: each press flips, release does nothing, auto-repeat does not flip', () => {
    const { h, calls } = setup('toggle');
    h.down(7);
    h.down(7);
    h.up(7);
    h.down(7);
    h.up(7);
    expect(calls).toEqual(['down', 'up']);
  });
  it('a tap-only key (the Copilot key) toggles even in hold mode, whenever its release arrives', () => {
    const { h, calls, wait } = setup('hold', { key: 7, tapOnly: true });
    h.down(7);
    wait(400); // its release can come well after 250 ms, which hold mode would have taken for a real hold
    h.up(7);
    expect(calls).toEqual(['down']); // still recording
    wait(3000);
    h.down(7);
    h.up(7);
    expect(calls).toEqual(['down', 'up']);
    h.down(7);
    h.up(7);
    expect(calls).toEqual(['down', 'up', 'down']); // and starts again on the next tap
  });

  it('latch off: even a quick tap stops on release, so Command Mode records exactly while held', () => {
    const calls: string[] = [];
    let t = 0;
    const d = {
      state: 'idle',
      keyDown: async () => void calls.push('down'),
      keyUp: async () => void calls.push('up'),
    };
    const h = createHotkeyHandler(
      d,
      () => 'hold',
      () => ({ key: 7 }),
      () => t,
      { latch: false },
    );
    h.down(7);
    t += 40; // a tap, far shorter than TAP_MS
    h.up(7);
    expect(calls).toEqual(['down', 'up']);
  });

  it('a combo needs its exact modifiers; the same key alone or with others does nothing', () => {
    const chord: Chord = { key: 32, mods: { ctrl: true, alt: true, shift: false, meta: false } };
    const { h, calls } = setup('toggle', chord);
    const none = { ctrl: false, alt: false, shift: false, meta: false };
    h.down(32, none);
    h.up(32);
    h.down(32, { ...none, ctrl: true });
    h.up(32);
    h.down(32, { ...none, ctrl: true, alt: true, shift: true });
    h.up(32);
    expect(calls).toEqual([]);
    h.down(32, { ...none, ctrl: true, alt: true });
    h.up(32);
    expect(calls).toEqual(['down']);
  });

  it('a single-key hotkey ignores modifier state (Right Ctrl reports Ctrl as held)', () => {
    const { h, calls } = setup('toggle', { key: 7 });
    h.down(7, { ctrl: true, alt: false, shift: false, meta: false });
    expect(calls).toEqual(['down']);
  });
});

describe('parseCombo', () => {
  const keys = { A: 30, D: 32, Space: 57, F9: 67, Ctrl: 29, CtrlRight: 3613, Shift: 42 };
  it('parses modifiers plus one key and normalizes the label', () => {
    expect(parseCombo('ctrl+alt+d', keys)).toEqual({
      chord: { key: 32, mods: { ctrl: true, alt: true, shift: false, meta: false } },
      label: 'Ctrl+Alt+D',
    });
    expect(parseCombo('Shift + Ctrl + Space', keys)?.label).toBe('Ctrl+Shift+Space');
    expect(parseCombo('Win+F9', keys)?.chord.mods?.meta).toBe(true);
  });
  it('rejects anything that could hijack normal typing or is malformed', () => {
    for (const bad of [
      'D',
      'F9',
      'Ctrl',
      'Ctrl+Shift',
      'Ctrl+D+A',
      'Ctrl+Ctrl+D',
      'Ctrl+',
      '',
      'Ctrl+Nope',
      'Ctrl+CtrlRight',
      'CtrlRight',
    ])
      expect(parseCombo(bad, keys)).toBeNull();
  });
});
