# Dictation cleanup behavior

Flow follows Wispr Flow's publicly documented desktop behavior as of 2026-11-25. Wispr's model, prompts, speech recognizer, and surrounding-text logic are proprietary, so identical output cannot be guaranteed.

Primary sources: [Auto Cleanup levels](https://docs.wisprflow.ai/articles/4283510616-Auto-Cleanup:-control-how-much-Flow-edits-your-dictation), [Smart Formatting and Backtrack](https://docs.wisprflow.ai/articles/5373093536-How-do-I-use-Smart-Formatting-&-Backtrack), [Personalized Style](https://wisprflow.ai/post/personalized-style), and [Wispr's own before/after example](https://wisprflow.ai/).

## Rules implemented

| Setting         | Behavior                                                                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| None            | Skip the cleanup API and insert the raw transcript. Spoken line breaks, saved snippets, and whole-utterance commands still run in code.                                                         |
| Light (default) | Remove hesitation fillers, accidental repeats, abandoned false starts, and clear self-corrections. Fix obvious grammar, spelling, capitalization, and punctuation with minimal wording changes. |
| Medium          | Apply Light cleanup, then allow rewording for clarity and concision while retaining facts, uncertainty, requests, and meaning.                                                                  |

Light and Medium also instruct the editor to respect explicit punctuation, format clear spoken enumerations as lists, preserve URLs/emails/file names and code-mixed language, and add paragraphs only at clear topic shifts. A meaningful use of “actually” or a deliberate repetition stays. The model receives the whole transcript segment for backtracking context. App tone controls formatting; it does not independently license a rewrite. The dictionary and writing-style paragraph still apply.

An explicit correction of a clock time such as “meet at 8:00 p.m. No, make it 7:00 p.m.” is resolved in code before model cleanup. This also applies if speech recognition hears “off 7:00” in the replacement clause. None still preserves the raw transcript.

## Differences that remain

- Wispr's recognizer and cleanup implementation are private. Flow uses Gemini Live for transcription and Gemini Flash-Lite for editing, so recognition and editorial choices may differ.
- Spoken punctuation, lists, and backtracking depend on the cleanup model's interpretation; only snippets, line breaks, and whole-utterance delete commands are deterministic.
- Flow does not inspect selected text or the surrounding line. It cannot match Wispr's context-sensitive casing or final-period rules exactly. It also pastes plain text rather than rich-text lists.
- The behavior tests check rule construction, settings migration, bypass, and safety fallbacks. They do not establish output equivalence with Wispr. Comparing the same dictated examples in both apps is the way to tune this further.
