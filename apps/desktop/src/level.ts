/** RMS of a PCM16 chunk mapped to 0..1 (speech sits around 0.02-0.1 of full scale). */
export function level(pcm: Buffer): number {
  const n = pcm.length >> 1;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = pcm.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  // Square-root-of-RMS gives a perceptual-ish curve; the offset keeps room noise at zero.
  return Math.min(1, Math.max(0, Math.sqrt(Math.sqrt(sum / n)) * 1.6 - 0.15));
}
