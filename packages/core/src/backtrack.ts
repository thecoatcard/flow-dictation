// Resolve an explicit replacement of a clock time before model cleanup. The first
// clause supplies the wording (including "for" if STT hears "off" later).
const CLOCK = String.raw`(?:\d{1,2}:[0-5]\d\s*(?:[ap]\.?(?:m)\.?)?|\d{1,2}\s*[ap]\.?(?:m)\.?)`;
const TIME_CORRECTION = new RegExp(
  String.raw`\b(${CLOCK})\s*[.!?,;]*\s*(?:\bno\b[\s,.!?]*)+(?:i\s+want\s+(?:it|the\s+meeting)\s+(?:for|at|to|off)|make\s+it)\s+(${CLOCK})`,
  'gi',
);

export function resolveTimeBacktrack(transcript: string): string {
  return transcript.replace(TIME_CORRECTION, (_match, _old: string, corrected: string) => corrected);
}

/** STT occasionally joins a sentence ending to the next first-person sentence. */
export function repairSentenceBoundary(transcript: string): string {
  return transcript.replace(/([.!?])(?=I(?:\s|['’]m\b))/g, '$1 ');
}
