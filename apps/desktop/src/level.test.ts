import { describe, expect, it } from 'vitest';
import { level } from './level';

const pcm = (amp: number, n = 1600) => {
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 5) * amp), i * 2);
  return b;
};

describe('level', () => {
  it('is 0 for silence and room noise, rises with loudness, caps at 1', () => {
    expect(level(Buffer.alloc(0))).toBe(0);
    expect(level(pcm(0))).toBe(0);
    expect(level(pcm(60))).toBe(0);
    const speech = level(pcm(3000));
    expect(speech).toBeGreaterThan(0.2);
    expect(level(pcm(12000))).toBeGreaterThan(speech);
    expect(level(pcm(32767))).toBeLessThanOrEqual(1);
  });
});
