import type { Mode } from '@flow/core';
import { describe, expect, it } from 'vitest';
import { createHotkeyHandler, TAP_MS } from './hotkey';

function setup(mode: Mode) {
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
    () => 7,
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
});
