import type { Snippet } from './config';

export type Segment =
  | { kind: 'text'; text: string }
  /** Inserted verbatim, never sent to the model. */
  | { kind: 'literal'; text: string }
  | { kind: 'break'; text: string };

/** Spoken actions. `delete-last` removes the last dictation, `read-back` speaks it; the rest press a key or shortcut. */
export type Command =
  | 'delete-last'
  | 'select-all'
  | 'undo'
  | 'press-enter'
  | 'press-tab'
  | 'press-escape'
  | 'read-back';

const BREAKS: Array<[string, string]> = [
  ['new paragraph', '\n\n'],
  ['new line', '\n'],
];
const COMMANDS: Array<[string, Command]> = [
  ['delete that', 'delete-last'],
  ['scratch that', 'delete-last'],
  ['select all', 'select-all'],
  ['undo that', 'undo'],
  ['undo', 'undo'],
  ['press enter', 'press-enter'],
  ['press tab', 'press-tab'],
  ['press escape', 'press-escape'],
];

/**
 * "Read that back", "read it back to me", "read that again", "read it out loud", "please read this aloud":
 * the many ways people ask to hear the last text. Only the whole utterance counts.
 */
const READ_BACK =
  /^(?:(?:please|can you|could you)\s+)?read\s+(?:(?:that|it|this|the last (?:one|text|dictation|thing)|my last (?:text|dictation))\s+)?(?:back|again|aloud|out loud|out)(?:\s+to me)?$|^(?:(?:please|can you|could you)\s+)?read\s+(?:that|it|this)\s+to me$/;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phraseRe = (p: string) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])${esc(p).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])[.,!?;:]*`,
    'giu',
  );

/** The whole utterance is a command ("Delete that."), nothing else. */
export function detectCommand(transcript: string): Command | null {
  const t = transcript
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:\s]+$/g, '');
  if (READ_BACK.test(t.replace(/\s+/g, ' '))) return 'read-back';
  return COMMANDS.find(([p]) => p === t)?.[1] ?? null;
}

/**
 * "Reply sounds good press enter": the words before are dictated, and Enter is pressed after them.
 * Only a trailing "press enter" counts, so the phrase inside a sentence is still just text.
 */
export function splitTrailingEnter(transcript: string): { text: string; enter: boolean } {
  const m = /[\s,.;:!?]*\bpress enter\b[\s.!?,;:]*$/i.exec(transcript);
  if (!m || !transcript.slice(0, m.index).trim()) return { text: transcript, enter: false };
  return { text: transcript.slice(0, m.index), enter: true };
}

/** Split a transcript on spoken breaks and snippet triggers. Deterministic; the LLM never sees them. */
export function segmentTranscript(transcript: string, snippets: Snippet[]): Segment[] {
  const rules: Array<{ phrase: string; seg: Segment }> = [
    ...BREAKS.map(([p, text]) => ({ phrase: p, seg: { kind: 'break', text } as Segment })),
    ...snippets.map((s) => ({
      phrase: s.trigger,
      seg: { kind: 'literal', text: s.expansion } as Segment,
    })),
  ].sort((a, b) => b.phrase.length - a.phrase.length);

  let segs: Segment[] = [{ kind: 'text', text: transcript }];
  for (const { phrase, seg } of rules) {
    const re = phraseRe(phrase);
    segs = segs.flatMap((s) => {
      if (s.kind !== 'text') return [s];
      const out: Segment[] = [];
      let last = 0;
      for (const m of s.text.matchAll(re)) {
        out.push({ kind: 'text', text: s.text.slice(last, m.index) }, seg);
        last = m.index + m[0].length;
      }
      out.push({ kind: 'text', text: s.text.slice(last) });
      return out;
    });
  }
  return segs.filter((s) => s.kind !== 'text' || s.text.trim());
}

/** Join cleaned pieces: spaces between inline pieces, none around breaks. */
export function joinSegments(parts: Segment[]): string {
  let out = '';
  let prevInline = false;
  for (const p of parts) {
    if (p.kind === 'break') {
      out = out.replace(/ +$/, '') + p.text;
      prevInline = false;
    } else if (p.text) {
      // Text around a spoken break or snippet already has boundary spaces.
      // Trimming here avoids doubled spaces, including when cleanup is disabled.
      const text = p.kind === 'text' ? p.text.trim() : p.text;
      if (!text) continue;
      out += (prevInline ? ' ' : '') + text;
      prevInline = true;
    }
  }
  return out;
}
