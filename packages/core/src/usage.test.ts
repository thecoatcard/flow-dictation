import { describe, expect, it } from 'vitest';
import { addUsage, emptyUsage, estimateCost, monthKey } from './usage';

describe('usage', () => {
  it('accumulates and prices', () => {
    let u = emptyUsage();
    u = addUsage(u, { audioSeconds: 1800, dictations: 1 });
    u = addUsage(u, { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(u).toEqual({
      audioSeconds: 1800,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      dictations: 1,
    });
    const c = estimateCost(u, 0.54);
    expect(c.stt).toBeCloseTo(0.27);
    expect(c.cleanup).toBeCloseTo(2.8);
    expect(c.total).toBeCloseTo(3.07);
  });

  it('keys months with zero padding', () => {
    expect(monthKey(new Date(2026, 0, 5))).toBe('2026-01');
  });
});
