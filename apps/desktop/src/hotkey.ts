import type { Mode } from '@flow/core';

interface Controller {
  state: string;
  keyDown(): Promise<void>;
  keyUp(): Promise<void>;
}

/**
 * Turns raw key events into dictation start/stop.
 * hold: press starts, release stops. toggle: each press flips. OS key auto-repeat is ignored in both.
 */
export function createHotkeyHandler(
  d: Controller,
  getMode: () => Mode,
  getKeycode: () => number,
): { down(code: number): void; up(code: number): void } {
  let held = false;
  return {
    down(code) {
      if (code !== getKeycode() || held) return;
      held = true;
      if (getMode() === 'hold') void d.keyDown();
      else void (d.state === 'recording' ? d.keyUp() : d.keyDown());
    },
    up(code) {
      if (code !== getKeycode()) return;
      held = false;
      if (getMode() === 'hold') void d.keyUp();
    },
  };
}
