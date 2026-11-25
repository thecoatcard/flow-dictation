/** Raw RMS of a PCM16 chunk as a fraction of full scale (speech sits around 0.02-0.1). */
export function rms(pcm: Uint8Array): number {
  const n = pcm.length >> 1;
  if (!n) return 0;
  const v = new DataView(pcm.buffer, pcm.byteOffset, n * 2);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = v.getInt16(i * 2, true) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

/** RMS of a PCM16 chunk mapped to 0..1 for the meter. */
export function level(pcm: Uint8Array): number {
  // Square-root-of-RMS gives a perceptual-ish curve; the offset keeps room noise at zero.
  return Math.min(1, Math.max(0, Math.sqrt(rms(pcm)) * 1.6 - 0.15));
}
