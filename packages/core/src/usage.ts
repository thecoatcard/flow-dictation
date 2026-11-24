export interface UsageTotals {
  audioSeconds: number;
  inputTokens: number;
  outputTokens: number;
  dictations: number;
}

export const emptyUsage = (): UsageTotals => ({
  audioSeconds: 0,
  inputTokens: 0,
  outputTokens: 0,
  dictations: 0,
});

export function addUsage(a: UsageTotals, b: Partial<UsageTotals>): UsageTotals {
  return {
    audioSeconds: a.audioSeconds + (b.audioSeconds ?? 0),
    inputTokens: a.inputTokens + (b.inputTokens ?? 0),
    outputTokens: a.outputTokens + (b.outputTokens ?? 0),
    dictations: a.dictations + (b.dictations ?? 0),
  };
}

/** gemini-3.5-flash-lite list price, USD per 1M tokens (ai.google.dev, checked 2026-11). */
export const CLEANUP_USD_PER_M = { input: 0.3, output: 2.5 } as const;

export interface CostEstimate {
  stt: number;
  cleanup: number;
  total: number;
}

/** STT price is user-adjustable: sources disagree on the live-transcribe rate. */
export function estimateCost(t: UsageTotals, sttUsdPerHour: number): CostEstimate {
  const stt = (t.audioSeconds / 3600) * sttUsdPerHour;
  const cleanup =
    (t.inputTokens / 1e6) * CLEANUP_USD_PER_M.input +
    (t.outputTokens / 1e6) * CLEANUP_USD_PER_M.output;
  return { stt, cleanup, total: stt + cleanup };
}

export const monthKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
