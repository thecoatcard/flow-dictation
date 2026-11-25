import { describe, expect, it } from 'vitest';
import { level, rms } from './level';
import { SpeechMeter } from './speech-gate';

function chunk(amp: number, n = 1600): Uint8Array {
  const b = new Int16Array(n);
  for (let i = 0; i < n; i++) b[i] = Math.round(amp * 32767 * (i % 2 ? 1 : -1));
  return new Uint8Array(b.buffer);
}

describe('rms/level', () => {
  it('measures a Uint8Array view with a byte offset', () => {
    const big = new Uint8Array(3200 + 10);
    big.set(chunk(0.5), 10);
    expect(rms(big.subarray(10))).toBeCloseTo(0.5, 2);
    expect(level(chunk(0))).toBe(0);
  });
});

describe('SpeechMeter', () => {
  it('rejects text from a recording that never got loud', () => {
    const m = new SpeechMeter();
    for (let i = 0; i < 10; i++) m.push(chunk(0.002));
    expect(m.rejects('Thank you for watching the show tonight')).toBe(true);
  });
  it('keeps real speech', () => {
    const m = new SpeechMeter();
    m.push(chunk(0.002));
    m.push(chunk(0.08));
    expect(m.rejects('send the report tomorrow')).toBe(false);
  });
  it('rejects stock phantom phrases from quiet audio only', () => {
    const quiet = new SpeechMeter();
    quiet.push(chunk(0.012));
    expect(quiet.rejects('Thank you.')).toBe(true);
    const loud = new SpeechMeter();
    loud.push(chunk(0.1));
    expect(loud.rejects('Thank you.')).toBe(false);
  });
  it('cannot judge without audio, so keeps the text', () => {
    expect(new SpeechMeter().rejects('hello')).toBe(false);
  });
});
