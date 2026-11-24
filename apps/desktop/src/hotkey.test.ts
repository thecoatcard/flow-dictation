import type { Mode } from '@flow/core';
import { describe, expect, it } from 'vitest';
import { createHotkeyHandler } from './hotkey';

function setup(mode: Mode) {
  const calls: string[] = [];
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
  );
  return { h, calls };
}

describe('createHotkeyHandler', () => {
  it('hold: press starts, release stops, auto-repeat ignored, other keys ignored', () => {
    const { h, calls } = setup('hold');
    h.down(7);
    h.down(7);
    h.down(7);
    h.down(8);
    h.up(8);
    h.up(7);
    expect(calls).toEqual(['down', 'up']);
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
