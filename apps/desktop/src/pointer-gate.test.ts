import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }) } }));

import { insideBox, PointerGate } from './pointer-gate';

/** A window stand-in that records every mouse-event setting it is given. */
function fakeWindow(bounds = { x: 100, y: 100, width: 300, height: 100 }) {
  const calls: boolean[] = [];
  const win = {
    isDestroyed: () => false,
    isVisible: () => visible.v,
    getBounds: () => bounds,
    setIgnoreMouseEvents: (ignore: boolean) => void calls.push(ignore),
  };
  const visible = { v: true };
  return { win: win as never, calls, visible, bounds };
}

describe('insideBox', () => {
  it('counts the edge and a little slack, but not far away', () => {
    const box = { x: 10, y: 10, width: 40, height: 40 };
    expect(insideBox({ x: 30, y: 30 }, box)).toBe(true);
    expect(insideBox({ x: 8, y: 30 }, box)).toBe(true);
    expect(insideBox({ x: 2, y: 30 }, box)).toBe(false);
  });
});

describe('PointerGate', () => {
  const setup = (cursor: { x: number; y: number }) => {
    const w = fakeWindow();
    const state = { cursor, now: 1000, area: { x: 100, y: 30, width: 60, height: 40 } as null | { x: number; y: number; width: number; height: number } };
    const changes: boolean[] = [];
    const gate = new PointerGate({
      win: () => w.win,
      area: () => state.area,
      onChange: (inside) => changes.push(inside),
      cursor: () => state.cursor,
      now: () => state.now,
    });
    return { ...w, state, changes, gate };
  };

  it('catches the mouse only while the cursor is over the content, and says when it comes and goes', () => {
    const t = setup({ x: 0, y: 0 });
    t.gate.tick();
    expect(t.calls).toEqual([]); // outside and nothing changed: nothing to set
    t.state.cursor = { x: 230, y: 150 }; // window-local (130, 50): inside the area
    t.gate.tick();
    expect(t.calls).toEqual([false]);
    expect(t.changes).toEqual([true]);
    t.state.cursor = { x: 5, y: 5 };
    t.gate.tick();
    expect(t.calls).toEqual([false, true]);
    expect(t.changes).toEqual([true, false]);
  });

  it('stays interactive during a drag even if the cursor leaves, then lets go', () => {
    const t = setup({ x: 230, y: 150 });
    t.gate.tick();
    t.gate.hold(1500);
    t.state.cursor = { x: 900, y: 900 };
    t.gate.tick();
    expect(t.gate.isInside).toBe(true);
    t.state.now += 2000; // the drag stopped sending updates
    t.gate.tick();
    expect(t.gate.isInside).toBe(false);
    t.state.cursor = { x: 230, y: 150 };
    t.gate.tick();
    t.gate.hold();
    t.gate.release();
    t.state.cursor = { x: 900, y: 900 };
    t.gate.tick();
    expect(t.gate.isInside).toBe(false);
  });

  it('puts the setting right again every second, even when nothing changed', () => {
    const t = setup({ x: 0, y: 0 });
    for (let i = 0; i < 50; i++) t.gate.tick();
    expect(t.calls).toEqual([true, true]); // outside: click-through, set twice in 50 ticks
  });

  it('does nothing while the window is hidden, and has no area to catch when there is no content', () => {
    const t = setup({ x: 230, y: 150 });
    t.visible.v = false;
    t.gate.tick();
    expect(t.calls).toEqual([]);
    t.visible.v = true;
    t.state.area = null;
    t.gate.tick();
    expect(t.gate.isInside).toBe(false);
  });
});
