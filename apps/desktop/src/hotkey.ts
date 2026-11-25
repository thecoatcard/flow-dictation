import type { Mode } from '@flow/core';

interface Controller {
  state: string;
  keyDown(): Promise<void>;
  keyUp(): Promise<void>;
}

/** A press shorter than this is a tap, not a hold. */
export const TAP_MS = 250;

export interface Mods {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

const NO_MODS: Mods = { ctrl: false, alt: false, shift: false, meta: false };

/**
 * A hotkey: one key code, and optionally the modifiers that must be held with it.
 * `mods` undefined means a single key (Right Ctrl, F23...) and the modifier state is ignored.
 */
export interface Chord {
  key: number;
  mods?: Mods;
  /**
   * The key reports its release almost at once (a laptop Copilot key sends press and release as one
   * macro), so it cannot be held. It always works as tap to start, tap again to stop.
   */
  tapOnly?: boolean;
}

const sameMods = (a: Mods, b: Mods) =>
  a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.meta === b.meta;

const matches = (chord: Chord, code: number, mods: Mods) =>
  code === chord.key && (!chord.mods || sameMods(chord.mods, mods));

const MODIFIER_NAMES: Record<string, keyof Mods> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'meta',
  win: 'meta',
  windows: 'meta',
  cmd: 'meta',
  command: 'meta',
};
const MODIFIER_KEY = /^(Ctrl|Alt|Shift|Meta)(Right)?$/;

/**
 * "Ctrl+Alt+D" -> a chord. Needs at least one modifier and exactly one other key, so an everyday
 * key can never become the hotkey. `keys` maps key names (as in uiohook-napi) to codes.
 */
export function parseCombo(
  text: string,
  keys: Record<string, number>,
): { chord: Chord; label: string } | null {
  // uiohook's key table also holds reverse code -> name entries; only real names count.
  const byLower = new Map(
    Object.keys(keys)
      .filter((k) => typeof keys[k] === 'number')
      .map((k) => [k.toLowerCase(), k]),
  );
  const mods = { ...NO_MODS };
  let keyName: string | undefined;
  for (const raw of text.split('+')) {
    const token = raw.trim();
    if (!token) return null;
    const mod = MODIFIER_NAMES[token.toLowerCase()];
    if (mod) {
      if (mods[mod]) return null; // repeated modifier
      mods[mod] = true;
      continue;
    }
    const name = byLower.get(token.toLowerCase());
    if (!name || MODIFIER_KEY.test(name) || keyName) return null;
    keyName = name;
  }
  if (!keyName || !(mods.ctrl || mods.alt || mods.shift || mods.meta)) return null;
  const label = [
    mods.ctrl && 'Ctrl',
    mods.alt && 'Alt',
    mods.shift && 'Shift',
    mods.meta && 'Win',
    keyName,
  ]
    .filter(Boolean)
    .join('+');
  return { chord: { key: keys[keyName]!, mods }, label };
}

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
  getChord: () => Chord,
  now: () => number = Date.now,
  opts: { latch?: boolean } = {},
): { down(code: number, mods?: Mods): void; up(code: number): void } {
  const latch = opts.latch ?? true; // false: always record exactly while the key is down
  let held = false;
  let latched = false; // a tap left recording on; the next press stops it
  let downAt = 0;
  let stopping = false; // this press ended a latched recording; its release must not do anything
  return {
    down(code, mods = NO_MODS) {
      const chord = getChord();
      if (!matches(chord, code, mods) || held) return;
      held = true;
      if (getMode() === 'toggle' || chord.tapOnly) {
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
      const chord = getChord();
      if (code !== chord.key) return;
      held = false;
      if (chord.tapOnly) return; // the release carries no meaning for a key that cannot be held
      if (stopping) {
        stopping = false;
        return;
      }
      if (getMode() !== 'hold' || latched) return;
      if (latch && now() - downAt < TAP_MS) latched = true;
      else void d.keyUp();
    },
  };
}
