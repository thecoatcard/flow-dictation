const PREFACE =
  /^\s*(sure|certainly|of course|here is|here's|here are|okay,|ok,|as an ai|i can't|i cannot|i'm sorry)\b/i;

/** True when text opens like a chatty assistant reply ("Sure, here is..."). */
export const startsWithPreface = (text: string): boolean => PREFACE.test(text);

/** Returns the model output if it looks like a plain cleanup, otherwise the raw input. */
export function guardOutput(raw: string, output: string): string {
  const out = output.trim();
  if (!out) return out; // empty output is the contract for noise-only input
  if (PREFACE.test(out) && !PREFACE.test(raw)) return raw.trim();
  if (out.length > raw.length * 2 + 20) return raw.trim();
  return out;
}
