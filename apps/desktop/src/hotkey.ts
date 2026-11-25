import type { Mode } from '@flow/core';

interface Controller {
  state: string;
  keyDown(): Promise<void>;
  keyUp(): Promise<void>;
}

/** A press shorter than this is a tap, not a hold. */
export const TAP_MS = 250;

/**
 * Turns raw key events into dictation start/stop. OS key auto-repeat is ignored in both modes.
 *
 * hold: recording lasts while the key is down. A quick tap instead keeps recording until the next
 * press, so keys that report press and release together (a laptop Copilot key) still work.
 * toggle: each press flips between recording and stopped.
 */
export function createHotkeyHandler(
  d: Controller,
  getMode: () => Mode,
  getKeycode: () => number,
  now: () => number = Date.now,
): { down(code: number): void; up(code: number): void } {
  let held = false;
  let latched = false; // a tap left recording on; the next press stops it
  let downAt = 0;
  let stopping = false; // this press ended a latched recording; its release must not do anything
  return {
    down(code) {
      if (code !== getKeycode() || held) return;
      held = true;
      if (getMode() === 'toggle') {
        latched = false;
        void (d.state === 'recording' ? d.keyUp() : d.keyDown());
        return;
      }
      if (latched && d.state === 'recording') {
        latched = false;
        stopping = true;
        void d.keyUp();
        return;
      }
      latched = false; // a latched recording that already ended (error, timeout) starts fresh
      downAt = now();
      void d.keyDown();
    },
    up(code) {
      if (code !== getKeycode()) return;
      held = false;
      if (stopping) {
        stopping = false;
        return;
      }
      if (getMode() !== 'hold' || latched) return;
      if (now() - downAt < TAP_MS) latched = true;
      else void d.keyUp();
    },
  };
}
