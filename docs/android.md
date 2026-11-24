# Flow for Android (early debug build)

The first native Android keyboard lives in `apps/android`. It is an `InputMethodService`, so Android opens it for text fields after the user enables Flow and selects it as the default keyboard. Tapping a text field does **not** start the microphone; the user taps **Speak**, talks, then taps **Stop**. Flow sends 16 kHz PCM to Gemini Live, cleans the transcript with Flash-Lite, and inserts text through `InputConnection.commitText` rather than the clipboard.

## Build and install

Install Android Studio (or JDK 17 and Android SDK platform 35 with Build Tools 35). From PowerShell:

```powershell
cd apps/android
.\gradlew.bat testDebugUnitTest assembleDebug lintDebug
adb install -r .\app\build\outputs\apk\debug\app-debug.apk
```

The debug APK is signed with the local Android debug key. It is for testing, not Play Store distribution. On the phone, open **Flow**, grant microphone permission, save a Google AI API key, then use **Enable Flow keyboard** and **Choose default keyboard**. Android requires both user actions; an app cannot silently make itself the default keyboard.

## Current behavior

- The keyboard has basic letter, shift, space, delete, punctuation, enter, and keyboard-switch keys.
- Dictation uses `gemini-3.5-transcribe-live` and `gemini-3.5-flash-lite`. None, Auto, Light and Medium cleanup are available. Clear time corrections, spoken line breaks, snippets and whole-utterance “delete that”/“scratch that” commands are handled in code. Cleanup failure inserts the transcript.
- The API key is encrypted with Android Keystore, and app backups are disabled. Audio is not saved. Voice is disabled in password and no-personalized-learning fields. Recording stops if the field changes or keyboard closes, and a two-minute cap stops a forgotten recording.
- Dictionary spellings, a writing-style paragraph, snippets, default tone, and per-app tone by package ID are editable in the app. The most recently focused app ID appears in settings.

## Verification still needed on a phone

The project compiles and JVM tests pass, but no Android device or emulator was attached during development. Verify first-run enable/select flows, microphone permission, Live WebSocket setup and final transcript, insertion in several apps, focus changes during recording, private fields, and network/key errors on a real device. The keyboard is an early MVP: autocorrect, suggestions, gesture typing, multilingual key layouts, personalization import/export, and Play Store signing are not yet built. The Kotlin cleanup prompt follows the desktop rules but is a separate implementation, so parity should be checked with shared transcript examples before broader release.
