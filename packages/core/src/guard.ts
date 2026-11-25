const PREFACE =
  /^\s*(sure|certainly|of course|here is|here's|here are|okay,|ok,|as an ai|i can't|i cannot|i'm sorry)\b/i;

/** True when text opens like a chatty assistant reply ("Sure, here is..."). */
export const startsWithPreface = (text: string): boolean => PREFACE.test(text);

const NOISE_TAG =
  /[[(]\s*(?:music|noise|silence|applause|laughter|laughs|coughing|coughs|cough|breathing|background noise|inaudible|unintelligible|static|sighs|clears throat|crosstalk)\s*[\])]/gi;

/** Removes annotations such as "[Music]" or "(inaudible)" that speech models write for non-speech sound. */
export function stripNoiseTags(text: string): string {
  return text.replace(NOISE_TAG, ' ').replace(/ {2,}/g, ' ').trim();
}

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;
const wordChars = (s: string): number => (s.match(/[\p{L}\p{N}]/gu) ?? []).length;

/** Returns the model output if it looks like a plain cleanup, otherwise the raw input. */
export function guardOutput(raw: string, output: string): string {
  let out = output.trim();
  // The prompt forbids code fences, but models sometimes add them anyway.
  const fence = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(out);
  if (fence && !raw.includes('```')) out = fence[1]!.trim();
  if (!out) {
    // Empty output is the contract for noise-only input, but not for real speech: do not lose it.
    return words(raw) >= 3 && wordChars(raw) >= 8 ? raw.trim() : out;
  }
  if (PREFACE.test(out) && !PREFACE.test(raw)) return raw.trim();
  if (out.length > raw.length * 2 + 20) return raw.trim();
  // A long dictation squeezed to a fraction of its length means sentences were dropped.
  if (words(raw) >= 12 && words(out) < words(raw) * 0.35) return raw.trim();
  return out;
}
