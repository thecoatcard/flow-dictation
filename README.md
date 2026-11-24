# Flow

A personal push-to-talk dictation app. Hold a key, speak, release: cleaned-up text appears at the cursor in whatever app has focus. It talks straight to Google's Gemini API with your own key. There is no server of ours and no account.

Status: built and unit-tested; dictation confirmed working against the live API on the author's machine. Not yet tested on a clean machine. See [docs/manual-test.md](docs/manual-test.md) for the checklist to run first.

## How it works

mic (16 kHz PCM) -> Gemini Live transcription -> `gemini-3.5-flash-lite` cleanup -> paste at cursor, then your clipboard is restored.

- Filler words, false starts and self-corrections are cleaned up. The cleanup step treats what you said as text to edit, never as instructions.
- If cleanup fails or is slow, the raw transcript is inserted instead.
- Per-app tone (casual / professional / literal / code), a dictionary, snippets, spoken commands ("new line", "new paragraph", "delete that") and a writing-style paragraph are all editable in Settings.

## Install (Windows)

1. Get a Google AI API key from <https://aistudio.google.com/apikey>.
2. Download the Windows setup installer from the [v0.0.1 release](https://github.com/thecoatcard/flow-dictation/releases/tag/v0.0.1), or build it from source below. Run the setup wizard to choose an install folder and create desktop and Start menu shortcuts. An older `Flow.exe` is a portable build; use the **Setup** file. The installer is unsigned, so Windows SmartScreen may show a warning.
3. On first launch the Settings window opens. Paste your key, press **Test**, then use **Record 5 seconds** to check the mic.
4. Hold **Right Ctrl** (default), speak, release.

Change the hotkey, mode (hold or press-to-toggle), microphone and autostart in Settings. A laptop Copilot key can be used: choose "Copilot key (F23)". Windows may still run its own Copilot action; if so, remap the key to a plain key with PowerToys Keyboard Manager.

The floating icon can be dragged to another position. In the default mode it fades away after five seconds of inactivity and returns when you press the dictation shortcut. Settings also offers an option to show it only while dictating.

## Build from source

Needs Node 20+ and pnpm 9.

```powershell
pnpm install
pnpm dev        # build and launch
pnpm test       # unit tests (core is built first)
pnpm --filter @flow/desktop dist   # Windows setup wizard in apps/desktop/release
```

Optional live checks with your key:

```powershell
$env:GEMINI_API_KEY = "<key>"
pnpm cleanup "um so like i think we should ship it tomorrow"
pnpm --filter @flow/core test          # also runs the 22 live adversarial cases
pnpm --filter @flow/core compare-stt -- clip.wav --models gemini-3.5-transcribe-live
```

## macOS (untested)

The code has macOS paths but nothing here has been run on a Mac. If you try it:

1. Launch Flow. macOS asks for **Microphone**: allow it.
2. **System Settings > Privacy & Security > Accessibility**: enable Flow. This lets it press Cmd+V for you.
3. **Privacy & Security > Input Monitoring**: enable Flow. This lets it see the hotkey. macOS cannot report this one to the app, so if the hotkey does nothing, this is the first thing to check.
4. Quit and reopen Flow after granting these. The default hotkey is right Option.
5. The app is unsigned: right-click it, choose Open the first time.

Settings > Permissions shows the status of each and links to the right pane.

## Linux

Not supported for now. Global key hooks and synthetic paste are restricted on Wayland.

## Cost

Settings > Usage shows this month's audio minutes, tokens and an estimated cost. Cleanup is $0.30 / $2.50 per 1M tokens (a dictated paragraph is a small fraction of a cent). The live-transcription price is not clearly published: third-party listings range from about $0.54 per audio hour to per-token rates of similar size. The app defaults to $0.54/hour and lets you change it. At $0.54/hour, 30 minutes of dictation every day is about $8 a month for speech alone, which is above the $5 target. Light use (10 minutes a day) is about $2.70. Check Google's pricing page and set the real figure.

## Privacy

- Audio goes only to Google's API. It is never saved.
- The API key is encrypted with the OS keychain (Electron `safeStorage`) in its own file, never in the config JSON, never logged.
- The debug log (`flow-debug.log` in the app data folder) holds timings and error types only, never transcripts.
- "Learn style" sends your pasted samples to Google once; the samples are not stored.

## Known limits

- No simulated-typing fallback: if the paste keystroke fails, the text stays on the clipboard and "Copy last dictation" in the tray menu has it.
- "Delete that" sends one undo keystroke, only within 60 seconds of the last insertion.
- Clipboard restore keeps text, HTML, RTF and images; other formats are lost.
- The "add to dictionary?" learning prompt (stretch goal) is not built: detecting edits in other apps is not feasible without heavy accessibility hooks.
- No app icon yet (default Electron icon) and no code signing.

More detail on choices: [docs/decisions.md](docs/decisions.md). API notes: [docs/api-notes.md](docs/api-notes.md).
