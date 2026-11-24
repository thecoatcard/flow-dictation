export type ErrorKind = 'bad-key' | 'quota' | 'network' | 'other';

/** Sort an API/transport failure into something the user can act on. */
export function classifyError(e: unknown): ErrorKind {
  const status =
    typeof e === 'object' && e !== null ? (e as { status?: unknown }).status : undefined;
  const text = `${status ?? ''} ${e instanceof Error ? e.message : String(e)}`;
  if (
    /API key not valid|API_KEY_INVALID|UNAUTHENTICATED|PERMISSION_DENIED|\b(401|403)\b/i.test(text)
  )
    return 'bad-key';
  if (/RESOURCE_EXHAUSTED|quota|\b429\b/i.test(text)) return 'quota';
  if (
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network|getaddrinfo/i.test(
      text,
    )
  )
    return 'network';
  return 'other';
}

const MESSAGES: Record<ErrorKind, string> = {
  'bad-key': 'Invalid API key. Check it in Settings.',
  quota: 'API quota exceeded. Try again later.',
  network: 'No network connection.',
  other: 'Dictation failed.',
};

export const friendlyMessage = (e: unknown): string => MESSAGES[classifyError(e)];
