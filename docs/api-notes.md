# Gemini API notes (verified 2026-11-25 via docs search; re-check before M2)

Sources: ai.google.dev/gemini-api/docs/live-api/live-transcribe, .../models/gemini-3.5-flash-lite

## Live transcription (STT)

- Model: `gemini-3.5-transcribe-live` (dedicated STT). `gemini-3.8-live` not confirmed in docs; compare in M2 if it exists.
- Transport: WebSocket, or `@google/genai` (`ai.live.connect`).
- Config: `response_modalities: ["TEXT"]`, `inputAudioTranscription` (JS) / `input_audio_transcription` (Py) = AudioTranscriptionConfig.
- Language: empty `language_codes` = auto-detect; or e.g. `es-ES`.
- Vocabulary hints: `custom_vocabulary` list in the same config -> feed dictionary terms here.
- Input audio: raw 16-bit PCM, 16 kHz mono (confirm exact mime `audio/pcm;rate=16000` in M2).
- Output in `server_content`: `interim_input_transcription` (provisional) and `input_transcription` (final).
- Max 10 min audio per session (from plan; not re-confirmed).

## Cleanup (Flash-Lite)

- Model: `gemini-3.5-flash-lite`, GA. $0.30/1M in, $2.50/1M out.
- Thinking: levels minimal/low/medium/high; minimal is the model default.
  Set via `config.thinkingConfig.thinkingLevel` in `@google/genai` (exact JS enum spelling UNCONFIRMED; check SDK types in M1).

## Open items for M1/M2

- Exact `@google/genai` field spellings (custom vocabulary, thinkingLevel).
- Whether Firebase "no options" note for AudioTranscriptionConfig is stale (likely).

## Confirmed from SDK types (@google/genai 3.6.1)

- `ai.live.connect({model, config:{responseModalities:[Modality.TEXT], inputAudioTranscription:{customVocabulary, languageCodes}}, callbacks})`.
- `serverContent.interimInputTranscription.text` = provisional; `serverContent.inputTranscription.text` = final chunk (we append chunks); `turnComplete`/`generationComplete` end the turn.
- Send: `session.sendRealtimeInput({audio:{data:base64, mimeType:'audio/pcm;rate=16000'}})`, end with `{audioStreamEnd:true}`.
- Flash-Lite thinking: `config.thinkingConfig.thinkingLevel = ThinkingLevel.MINIMAL`.

## M2 status

- UNVERIFIED against the live server (no API key in dev env): whether `turnComplete` follows `audioStreamEnd`; the 3 s timeout covers it. Check `finalizeMs` in the debug button.
- 3.5-transcribe vs 3.8-live comparison: run `pnpm --filter @flow/core compare-stt` with clips. Results: TODO (needs key + recordings).

## Verified in use (2026-11-25, first real run)
- `@google/genai` 3.6.1 defaults to API `v1`; Live needs `httpOptions: { apiVersion: 'v1beta' }` or the socket 404s. Set for both Live and cleanup clients.
- `gemini-3.5-transcribe-live` works with `responseModalities: [TEXT]`.
- `gemini-3.8-live` exists but rejects TEXT-only (close 1007); it needs AUDIO output, so it is not a good transcription fit. Kept as a Settings option.
- Some modes send a cumulative `inputTranscription`; SttSession replaces instead of appending when the new text starts with the old.
