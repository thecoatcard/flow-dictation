/**
 * Dictionary suggestions from a correction. When the user fixes a dictation ("cooper net is" ->
 * "Kubernetes"), the words that appear only in the corrected text and look like names or technical
 * terms are worth teaching the dictionary. Everyday words are ignored so the list stays useful.
 */

const EDGE_PUNCT = /^[\s"'“”‘’([{<]+|[\s"'“”‘’)\]}>.,;:!?…]+$/gu;

interface Token {
  text: string;
  startsSentence: boolean;
}

function tokens(text: string): Token[] {
  const out: Token[] = [];
  let startsSentence = true;
  for (const raw of text.split(/\s+/)) {
    const word = raw.replace(EDGE_PUNCT, '');
    if (word) out.push({ text: word, startsSentence });
    startsSentence = /[.!?…]["'”’)]*$/.test(raw) || raw === '';
  }
  return out;
}

/** Looks like a name, product, acronym or identifier rather than an everyday word. */
function looksLikeTerm({ text, startsSentence }: Token): boolean {
  if (!/\p{L}/u.test(text)) return false; // numbers on their own are not terms
  if (/\d/.test(text)) return true; // k8s, GPT4, v2
  if (/\p{Ll}\p{Lu}/u.test(text)) return true; // camelCase, iPhone, McDonald
  if (/^\p{Lu}{2,}$/u.test(text)) return true; // acronym: API, EPAM
  if (/[_.#+]/.test(text) && text.length > 2) return true; // Node.js, C#, snake_case
  return /^\p{Lu}/u.test(text) && !startsSentence; // a capitalized word inside a sentence
}

/**
 * Terms in `after` that were not in `before` and are not already `known`, in order, without repeats.
 * Matching ignores case, so only genuinely new words are proposed.
 */
export function learnTerms(before: string, after: string, known: string[] = []): string[] {
  const seen = new Set([
    ...tokens(before).map((t) => t.text.toLowerCase()),
    ...known.map((k) => k.trim().toLowerCase()),
  ]);
  const out: string[] = [];
  for (const t of tokens(after)) {
    const key = t.text.toLowerCase();
    if (seen.has(key) || t.text.length < 2 || !looksLikeTerm(t)) continue;
    seen.add(key);
    out.push(t.text);
  }
  return out;
}
