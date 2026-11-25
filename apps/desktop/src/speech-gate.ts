import { rms } from './level';

/** A chunk this loud (RMS, fraction of full scale) counts as possible speech. Room noise after suppression sits well below. */
export const SPEECH_RMS = 0.01;
/** Below this peak a clip is quiet enough that stock "phantom" phrases are likely hallucinations. */
const QUIET_PEAK = 0.03;

/** Phrases speech models invent from near-silence. Only trusted when the audio itself was quiet. */
const PHANTOM =
  /^\s*(?:(?:thank you|thanks|thanks for watching|thank you for watching|you|bye|bye-bye|okay|ok|so|uh|um|hmm|mm|\.+)[\s.!?,]*)+$/i;

/** Tracks how loud a recording got, so noise-only clips can be dropped before their text is used. */
export class SpeechMeter {
  chunks = 0;
  peak = 0;
  voiced = 0;

  push(chunk: Uint8Array): void {
    const r = rms(chunk);
    this.chunks++;
    if (r > this.peak) this.peak = r;
    if (r >= SPEECH_RMS) this.voiced++;
  }

  /**
   * True when the transcript should be thrown away: the mic never heard anything speech-like,
   * or it was quiet and the text is one of the stock phrases models make up from silence.
   * With no chunks at all the meter cannot judge, so it keeps the text.
   */
  rejects(text: string): boolean {
    if (!this.chunks) return false;
    if (this.voiced === 0) return true;
    return this.peak < QUIET_PEAK && PHANTOM.test(text);
  }
}
