import type { FlowConfig, Tone } from './config';

const DEVANAGARI = /[ऀ-ॿ]/;
const FILLERS = /\b(?:u+m+|u+h+|e+r+m*|h+m+|m+h*m+|a+h+|you know|i mean|kind of|sort of)\b/i;
const CORRECTIONS = /\b(?:no wait|wait no|actually no|no no|scratch that|never mind|sorry|or rather|rather)\b/i;
const SPOKEN_MARKS = /\b(?:period|full stop|comma|question mark|exclamation (?:point|mark)|colon|semicolon|em dash|new line|new paragraph)\b/i;
const SPOKEN_SYMBOLS = /\b(?:dot com|dot org|at the rate|underscore|slash|hashtag)\b/i;
const LIST_WORDS = /\b(?:first|second|third|number one|number two)\b|\b(?:one|two|three)[,;:]/i;
const REPEAT = /\b([\p{L}\p{N}']+(?:\s+[\p{L}\p{N}']+)?)\s+\1\b/iu; // a word or a pair said twice
const LOWER_I = /(?:^|[\s(])i(?:$|[\s',.!?])/;
const MAX_CHARS = 600;

/**
 * True when Auto cleanup would leave this text alone, so the model call (the slowest step) can be skipped.
 * Deliberately strict: any sign of a filler, stutter, correction, spoken punctuation, list, odd casing or a
 * missing sentence mark sends the text to the model as before.
 */
export function isClearAlready(text: string, config: FlowConfig, tone: Tone): boolean {
  if (config.cleanupLevel !== 'auto' || tone === 'code' || config.outputLanguage) return false;
  const t = text.trim();
  if (!t || t.length > MAX_CHARS || t.includes('\n')) return false;
  // Long or multi-sentence speech may need lists and paragraphs, so it goes to the model.
  if (config.smartFormatting && tone !== 'literal' && (t.length > 240 || (t.match(/[.?!]\s+\S/g)?.length ?? 0) >= 2)) return false;
  if (config.hindiOutput === 'devanagari' || DEVANAGARI.test(t)) return false; // script handling needs the model
  if (!/^[\p{Lu}\p{N}"'(]/u.test(t) || !/[.?!…]["')]*$/.test(t)) return false; // needs capital and end mark
  if (FILLERS.test(t) || CORRECTIONS.test(t) || SPOKEN_MARKS.test(t) || SPOKEN_SYMBOLS.test(t)) return false;
  if (LIST_WORDS.test(t) || REPEAT.test(t) || LOWER_I.test(t)) return false;
  if (/\s{2,}|\s[,.;:!?]/.test(t)) return false; // spacing needs fixing
  const lower = t.toLowerCase();
  for (const d of config.dictionary) {
    const term = d.term.trim();
    if (term && lower.includes(term.toLowerCase()) && !t.includes(term)) return false; // spelling to correct
  }
  return true;
}
