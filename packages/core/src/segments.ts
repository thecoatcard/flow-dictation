import type { Snippet } from './config';

export type Segment =
  | { kind: 'text'; text: string }
  /** Inserted verbatim, never sent to the model. */
  | { kind: 'literal'; text: string }
  | { kind: 'break'; text: string };

export type Command = 'delete-last';

const BREAKS: Array<[string, string]> = [
  ['new paragraph', '\n\n'],
  ['new line', '\n'],
];
const COMMANDS: Array<[string, Command]> = [
  ['delete that', 'delete-last'],
  ['scratch that', 'delete-last'],
];

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
  return COMMANDS.find(([p]) => p === t)?.[1] ?? null;
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
      out += (prevInline ? ' ' : '') + p.text;
      prevInline = true;
    }
  }
  return out;
}
