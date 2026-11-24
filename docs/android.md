# Flow for Android

Speak anywhere on your phone. Flow adds a small floating mic next to your normal keyboard. Tap it in any text field, talk, and cleaned-up text is inserted where your cursor is. It uses the same Gemini transcription and cleanup as the [Windows app](../README.md), with the same personalization.

> **Status: early test build.** It is a sideloaded APK signed with a debug key, not a Play Store release. It has been tested on one physical phone. Expect rough edges and please [open an issue](https://github.com/thecoatcard/flow-dictation/issues) when you find one.

## What you need

- An Android 8.0 (API 26) or newer phone.
- A Google Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey). You pay Google directly for what you use; see [Cost](../README.md#cost).
- A way to install an APK: a USB cable and `adb` (recommended), or the phone's own file install.

## 1. Install

Download `Flow-Android-<version>.apk` (and its `.sha256` file) from the [latest release](https://github.com/thecoatcard/flow-dictation/releases/latest). It is one release page for both apps: the Windows installer (`Flow.Setup.*.exe`), the Android APK and the source code.

Check the download if you like. The SHA-256 in the `.sha256` file should match:

```powershell
Get-FileHash .\Flow-Android-0.1.7.apk -Algorithm SHA256
```

**Recommended: install from your computer with adb.** Turn on *Developer options → USB debugging* on the phone, plug it in, accept the prompt, then:

```powershell
adb devices
adb install -r .\Flow-Android-0.1.7.apk
```

`adb devices` must list your phone as `device`. If the install fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, an older Flow signed with a different key is installed; uninstall it first (this removes its saved settings and key).

**Installing the file on the phone instead** (for example sent through a chat app) usually triggers **Google Play Protect: "App blocked to protect your device"**. Flow asks for Accessibility access, which Play Protect treats as sensitive for unverified apps. Keep Play Protect on and use the adb route above. The route that removes this for everyone is a Google Play internal test track, which needs a Play Console account and review of Flow's Accessibility use.

## 2. Allow the permissions

Open **Flow** and work through **Get ready**:

| Permission | Why |
| --- | --- |
| **Microphone** | Records while you dictate. Audio is only recorded after you start. |
| **Floating bubble** (display over other apps) | Shows the mic next to your keyboard. |
| **Text insertion** (Accessibility → *Flow text insertion*) | Finds the field you selected and inserts your text there. Flow explains this before opening Android's settings. |

Flow never records just because a field gained focus. It skips password, number, phone and web-address fields.

### "Restricted setting" blocks the Accessibility toggle

On Android 13 and newer, apps installed outside the Play Store cannot use Accessibility until you allow it:

1. Open **Settings → Apps → Flow**.
2. Tap **⋮ (More options) → Allow restricted settings**, and confirm with your screen lock.
3. Go to **Settings → Accessibility → Installed apps → Flow text insertion** and turn it on.

The *Allow restricted settings* item only appears after you have tried to open the toggle once. Only do this for an APK you trust.

## 3. Add your API key

1. In **Google API**, paste your key and tap **Save API key**. It is encrypted with the Android Keystore and never shown again.
2. Tap **Test API connection**. This checks the cleanup model and the live transcription connection without recording. You should see *API ready*.

## 4. Dictate

1. Once the three permissions are allowed, the floating mic turns on by itself. It keeps running, and comes back after the phone restarts or the system closes it, until you tap **Stop floating mic** in the app (or **Stop** in its notification). If it was stopped, tap **Show floating mic** to turn it on again.
2. Open any app and tap a text field. The mic appears beside the keyboard.
3. **Tap** the mic, speak, then tap the **✓** (or tap the pill) to finish. Or **hold** the mic while you speak and release to finish.
4. Flow shows a moving waveform while it listens, a soft pulse while it writes, then **Inserted**.

| Pill | Meaning |
| --- | --- |
| Small round mic with a violet ring | Ready. Fades slightly after 5 seconds and returns when touched. |
| **✕** · waveform · **✓** | Listening. **✕** cancels, **✓** finishes. The bars move with your voice. |
| Waveform pulse | Writing your text. **✕** cancels. |
| Check or warning text | Result, such as *Inserted*, *No speech heard* or an error. |

Drag the bubble to move it; it snaps to the nearest screen edge. **Reset bubble position** in the app puts it back. There is a five-minute cap per dictation, with a warning one minute before; Flow submits automatically at the cap. The phone gives a small vibration when listening starts and when you finish.

### Voice commands

- "**New line**" and "**new paragraph**" insert line breaks.
- "**Delete that**" or "**scratch that**" removes the last dictation if the field has not changed since. It works when Flow inserted the text directly; it can not undo a paste (see Troubleshooting).
- Your own **snippets** expand when you say the trigger phrase.

## 5. Make it sound like you

All of these are on the main screen and match the Windows app.

- **Auto cleanup** sets how much Flow edits after transcription, for every app. **None** pastes the raw transcript. **Auto** leaves clean speech alone and uses a light edit only when needed. **Light** removes fillers, repeats and false starts and fixes grammar with minimal rewriting. **Medium** also rewords tangled phrases. The choice saves as soon as you tap it.
- **Hindi** chooses how spoken Hindi is written. **Hinglish (Roman)** is the default: when you speak Hindi, Flow types it in English letters, like "main kal office jaunga" or "kya haal hai", and keeps any English words as English. **Devanagari** types Hindi in Devanagari instead. Speech that is entirely English stays English, and other languages are written as you speak them. This works with every cleanup level, including None, which makes only the script change. The choice saves as soon as you tap it.
- **Default app tone** and **tone by app**: Casual, Professional, Literal or Code. Add apps one per line as `package=tone`, for example `com.whatsapp=casual`. The most recent text field's package is shown to copy from.
- **Dictionary**: names and terms to always spell exactly, one per line. Add an optional note after a bar, like `Spring Boot | Java framework`; the note is passed to the cleanup model, as on the Windows app.
- **Snippets**: `my email => me@example.com`, one per line.
- **Writing style**: a short description of how you write. **Draft my style** reads two or three pieces of your own writing (separated by a blank line), sends them to Google once, and writes the style paragraph for you to edit. The samples are not kept.
- Tap **Save preferences** after editing the text boxes.

### Usage

**Usage** shows this month's dictations, minutes of speech and an estimate of the transcription cost. Google's live transcription price is not clearly published, so enter the real figure from [ai.google.dev/pricing](https://ai.google.dev/pricing). Cleanup cost is not counted.

### Backup

**Export** saves your dictionary, tones, cleanup level, snippets and style to a JSON file. **Import** replaces them from such a file. The format is the same as the Windows app's Backup page, so you can move settings between phone and PC in either direction. Your API key never leaves the device.

## Privacy

- Your key stays on the phone, encrypted with the Android Keystore; app backups are disabled.
- Audio goes straight from the phone to Google's Gemini API as 16 kHz mono PCM, only while you dictate. Cleanup sends the transcript text to Google.
- Audio and transcripts are not logged or stored. Accessibility is used only to find the field you selected, read its current text and cursor, and insert your dictation. The app's package name is remembered for per-app tone.
- A cleanup failure never loses your words; the raw transcript is used instead. Cleanup uses the same prompt, safety checks and one-retry rule as the Windows app, and a test compares the prompt to the desktop's output.

## Troubleshooting

**"Live setup response timed out."** Fixed in 0.1.3. Gemini Live answers in binary WebSocket frames, which older builds ignored. Update to the latest APK. If it still happens, confirm the phone has internet, run **Test API connection**, and check that your key has access to `gemini-3.5-transcribe-live`.

**Text is pasted instead of typed, or only copied.** Some apps do not report their cursor position. Flow then pastes into the focused field. If the app refuses even that, the text is copied to the clipboard for you to paste. Either way your last dictation is on the clipboard, and **Copy last dictation** (in the Get ready card) copies it again. *Delete that* does not work after a paste.

**The bubble does not appear.** It only shows while the keyboard is open and a supported text field is focused. Check that the three permissions are allowed and that you have not stopped it (the button should say **Stop floating mic**). Flow restarts itself when the system closes it. On phones with strict battery managers, such as vivo, Xiaomi, Oppo or Samsung, also set Flow to **Unrestricted** battery use and allow it to start automatically so the system does not block the restart.

**"Tap a text field before speaking" or "Voice insertion is unavailable in this field."** The focused field is a password, number, phone or address field, or the app does not expose it to Accessibility.

**"No speech heard."** The microphone received nothing usable. Speak closer to the phone and try again.

**Reading the logs.** With USB debugging connected, these tags contain timings and short reason codes only, never audio or text:

```powershell
adb logcat -s FlowTiming FlowInsert
```

`FlowTiming` reports connection stages in milliseconds. `FlowInsert` explains why insertion fell back (`cursor_unknown`, `field_changed`, `paste_rejected`, `set_text_rejected`).

## Build from source

You need JDK 17 and the Android SDK (platform 35, build tools 35), or Android Studio. From PowerShell:

```powershell
cd apps/android
$env:JAVA_HOME = 'C:\path\to\jdk-17'
.\gradlew.bat testDebugUnitTest assembleDebug lintDebug
adb install -r .\app\build\outputs\apk\debug\app-debug.apk
```

Use JDK 17: Gradle 8.9 does not run on newer JDKs. The debug APK is signed with your local debug key, so an APK built on another computer cannot be installed over it without uninstalling first.

## Known limits

- Early test build, tested on a single device. Behaviour in other apps, keyboards and phone makers will vary; some custom editors reject Accessibility text actions.
- Not on the Play Store, so Play Protect and the restricted-setting step apply.
- Needs an internet connection; there is no offline mode.
- The Windows app's microphone check and tone-by-app list are not on Android yet.
