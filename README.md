# Flow

A personal push-to-talk dictation app. Hold a key, speak, release: cleaned-up text appears at the cursor in whatever app has focus. It talks straight to Google's Gemini API with your own key. There is no server of ours and no account.

Status: built and unit-tested; dictation confirmed working against the live API on the author's machine. Not yet tested on a clean machine. See [docs/manual-test.md](docs/manual-test.md) for the checklist to run first.

## How it works

mic (16 kHz PCM) -> Gemini Live transcription -> `gemini-3.5-flash-lite` cleanup -> paste at cursor, then your clipboard is restored.

- Auto cleanup offers **None** (raw transcript), **Light** (fillers, false starts, grammar) and **Medium** (also rephrases tangled speech for clarity). Light is the default. The cleanup step treats what you said as text to edit, never as instructions.
- If cleanup fails or is slow, the raw transcript is inserted instead.
- Per-app tone (casual / professional / literal / code), a dictionary, snippets, spoken commands ("new line", "new paragraph", "delete that") and a writing-style paragraph are all editable in Settings.

## Download and install (Windows)

1. Download the [Windows installer](https://github.com/thecoatcard/flow-dictation/releases/download/v0.0.3/Flow.Setup.0.0.3.exe) from [Releases](https://github.com/thecoatcard/flow-dictation/releases/latest). You do not need Git or Node.js to use the installer.
2. Run `Flow.Setup.0.0.3.exe` and follow the setup wizard. It installs per user and can create desktop and Start menu shortcuts. The installer is unsigned, so Windows may show a SmartScreen warning.
3. Get a [Google AI API key](https://aistudio.google.com/apikey). On first launch, paste it into Flow Settings, press **Test**, then use **Record 5 seconds** to check your microphone.
4. Hold **Right Ctrl** (default), speak, and release to insert text.

Change the hotkey, mode (hold or press-to-toggle), microphone and autostart in Settings. A laptop Copilot key can be used: choose "Copilot key (F23)". Windows may still run its own Copilot action; if so, remap the key to a plain key with PowerToys Keyboard Manager.

The floating icon can be dragged to another position. In the default mode it fades away after five seconds of inactivity and returns when you press the dictation shortcut. Settings also offers an option to show it only while dictating.

## Releases

- [Latest release notes and downloads](https://github.com/thecoatcard/flow-dictation/releases/latest) — Windows x64 preview.
- [v0.0.3 setup installer](https://github.com/thecoatcard/flow-dictation/releases/download/v0.0.3/Flow.Setup.0.0.3.exe) · [SHA-256 checksum](https://github.com/thecoatcard/flow-dictation/releases/download/v0.0.3/Flow.Setup.0.0.3.exe.sha256)

To download the installer from PowerShell with the [GitHub CLI](https://cli.github.com/) instead of a browser:

```powershell
gh release download v0.0.3 --repo thecoatcard/flow-dictation --pattern '*.exe'
Start-Process -FilePath '.\Flow.Setup.0.0.3.exe'
```

`git clone` downloads the source code; use the installer link above if you only want to run Flow.

## Clone and build from source

Install Node.js 20+ and Git first. From PowerShell:

```powershell
git clone https://github.com/thecoatcard/flow-dictation.git
cd flow-dictation
npm install --global pnpm@9.15.9
pnpm install
pnpm dev                            # build and run Flow from source
```

To build the Windows setup installer from the cloned repository:

```powershell
pnpm test
pnpm --filter @flow/desktop dist
Start-Process -FilePath '.\apps\desktop\release\Flow Setup 0.0.3.exe'
```

The installer is written to `apps/desktop/release/`. To update an existing clone, run `git pull --ff-only` and `pnpm install` before rebuilding.

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
- The debug log (`flow-debug.log` in the app data folder) holds timings and redacted error details, never audio or transcripts.
- "Learn style" sends your pasted samples to Google once; the samples are not stored.

## Known limits

- No simulated-typing fallback: if the paste keystroke fails, the text stays on the clipboard and "Copy last dictation" in the tray menu has it.
- "Delete that" sends one undo keystroke, only within 60 seconds of the last insertion.
- Clipboard restore keeps text, HTML, RTF and images; other formats are lost.
- The "add to dictionary?" learning prompt (stretch goal) is not built: detecting edits in other apps is not feasible without heavy accessibility hooks.
- The Windows installer is unsigned and has not been tested on a clean machine.

More detail on choices: [docs/decisions.md](docs/decisions.md). [Cleanup behavior and limitations](docs/cleanup-behavior.md). API notes: [docs/api-notes.md](docs/api-notes.md).
