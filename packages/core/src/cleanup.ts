import { GoogleGenAI, ThinkingLevel } from '@google/genai';

export interface CleanupClient {
  /** Returns the model's text for one cleanup request. Rejects on failure or abort. */
  generate(system: string, user: string, signal?: AbortSignal): Promise<string>;
}

export class GeminiCleanupClient implements CleanupClient {
  private readonly ai: GoogleGenAI;
  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly onUsage?: (u: { inputTokens: number; outputTokens: number }) => void,
  ) {
    this.ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1beta' } });
  }

  async generate(system: string, user: string, signal?: AbortSignal): Promise<string> {
    const res = await this.ai.models.generateContent({
      model: this.model,
      contents: user,
      config: {
        systemInstruction: system,
        temperature: 0,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        abortSignal: signal,
      },
    });
    const m = res.usageMetadata;
    if (m)
      this.onUsage?.({
        inputTokens: m.promptTokenCount ?? 0,
        outputTokens: (m.candidatesTokenCount ?? 0) + (m.thoughtsTokenCount ?? 0),
      });
    return res.text ?? '';
  }
}
