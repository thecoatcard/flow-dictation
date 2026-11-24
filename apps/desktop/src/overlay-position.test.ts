import { describe, expect, it } from 'vitest';
import { clampOrigin, defaultOrigin } from './overlay-position';

const size = { width: 260, height: 64 };
const main = { x: 0, y: 0, width: 1920, height: 1040 };
const second = { x: 1920, y: 0, width: 1280, height: 1000 };

describe('overlay position', () => {
  it('leaves a position that is on a display alone', () => {
    expect(clampOrigin({ x: 500, y: 400 }, size, [main])).toEqual({ x: 500, y: 400 });
  });

  it('pulls a stranded position back onto the only display', () => {
    const p = clampOrigin({ x: 3500, y: 200 }, size, [main]);
    expect(p.x + size.width / 2).toBe(1920); // centre sits on the right edge
    expect(p.y).toBe(200);
  });

  it('keeps a position on the second display when it is connected', () => {
    expect(clampOrigin({ x: 2500, y: 100 }, size, [main, second])).toEqual({ x: 2500, y: 100 });
  });

  it('does nothing without displays and centres the default', () => {
    expect(clampOrigin({ x: 1, y: 2 }, size, [])).toEqual({ x: 1, y: 2 });
    expect(defaultOrigin(main, size)).toEqual({ x: 830, y: 952 });
  });
});
