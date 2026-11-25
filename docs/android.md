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
Get-FileHash .\Flow-Android-0.1.14.apk -Algorithm SHA256
```

**Recommended: install from your computer with adb.** Turn on *Developer options → USB debugging* on the phone, plug it in, accept the prompt, then:

```powershell
adb devices
adb install -r .\Flow-Android-0.1.14.apk
```

`adb devices` must list your phone as `device`. If the install fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, an older Flow signed with a different key is installed; uninstall it first (this removes its saved settings and key).

**Installing the file on the phone instead** (for example sent through a chat app) usually triggers **Google Play Protect: "App blocked to protect your device"**. Flow asks for Accessibility access, which Play Protect treats as sensitive for unverified apps. Keep Play Protect on and use the adb route above. The route that removes this for everyone is a Google Play internal test track, which needs a Play Console account and review of Flow's Accessibility use.

## 2. Allow the permissions

## How the app is laid out

The home screen has the **Floating mic** button (Show or Stop). Tap the **☰** menu button at the top left to open a side menu with the settings pages, like the Windows app's sidebar. Pick a page to open it; the menu closes by itself. Android's Back closes the menu, then returns to Home.

| Page | What is on it |
| --- | --- |
| **Dictation** | Google API key (save, test, remove), speech language, start and stop sounds, vibration, reset bubble position, copy last dictation |
| **History** | Search, copy, fix and delete past dictations; keep-history switch; clear all |
| **Words and tone** | Default tone, tone by app, dictionary, snippets |
| **Writing style** | Auto cleanup, Hindi output, your style, draft my style |
| **Usage** | This month's dictations, minutes and estimated cost, speech price |
| **Updates** | Installed version and Check for updates |
| **Permissions** | Microphone, floating bubble and text insertion, and a battery helper that keeps the mic from being closed |
| **Backup** | Export and import your settings |

Open **Flow**, then **Permissions** from the ☰ menu, and allow:

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

## Updates

After the first install, Flow updates itself from the [latest release](https://github.com/thecoatcard/flow-dictation/releases/latest). While the floating mic is running it checks about once a day, and when you open the app. On Wi-Fi it downloads the new APK in the background and checks its SHA-256 against the checksum published beside it; a file that does not match is deleted and never installed. When an update is ready the Flow notification says **Update x.y.z is ready. Tap to install.** You can also open **Updates** in the app and tap **Check for updates**.

Android always asks you to confirm an install of an app that is not from the Play Store, so the last step is one tap on the system's **Update** button. The first time, Android also asks you to allow Flow to install apps: choose **Allow from this source**. Your settings and API key are kept.

**Google Play Protect can block the final step.** Flow asks for Accessibility access, so Play Protect may scan the update and show **Harmful app blocked**, the same as for the first sideload. Flow cannot and should not bypass that. When it happens, install the new APK from your computer, which skips the scan:

```powershell
adb install -r .\Flow-Android-0.1.14.apk
```

The Play Store route (an internal test track, which needs a Play Console account) is the way to make updates fully automatic for everyone.

An update can only replace the app if it is signed with the same key. Releases built on the same computer share a key. If Android says the update was signed with a different key, uninstall Flow and install the new APK once with `adb install`; you will have to enter your key and settings again, so export a backup first.

## 3. Add your API key

1. Open **Dictation**, and in **Google API** paste your key and tap **Save API key**. It is encrypted with the Android Keystore and never shown again.
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

Drag the bubble to move it; it snaps to the nearest screen edge. **Reset bubble position** on the **Dictation** page puts it back. There is a five-minute cap per dictation, with a warning one minute before; Flow submits automatically at the cap. The phone gives a small vibration when listening starts and when you finish.

### Voice commands

- "**New line**" and "**new paragraph**" insert line breaks.
- "**Delete that**" or "**scratch that**" removes the last dictation if the field has not changed since. It works when Flow inserted the text directly; it can not undo a paste (see Troubleshooting).
- "**Select all**" selects everything in the field.
- "**Press enter**" presses the keyboard's Enter or Send key (Android 11 or newer). Say it after a sentence, like "sounds good, press enter", to type the sentence and then press Enter. Said inside a longer sentence, such as "I will press enter now", it is just typed.
- Your own **snippets** expand when you say the trigger phrase.

### Quick Settings tile

Pull down the notification shade, tap the pencil (edit) and drag the **Flow mic** tile into your tiles. Tapping it turns the floating mic on or off. If a permission is missing, it opens Flow so you can allow it.

### History

Every dictation is saved on the phone (never uploaded) so you can find it later. Open **History** from the ☰ menu to search, **Copy**, **Fix** or **Delete** an entry. **Fix** lets you correct the text; if you changed names, product names or acronyms, Flow offers to add them to your dictionary, the same as the Windows app. Turn **Keep a history of dictations** off to stop saving, and **Clear all history** deletes everything. The last 300 are kept.

### Sounds, vibration and language

On **Dictation**, **Start and stop sounds** plays a short rising note when the mic is live and a softer falling note when it stops (the stop sound plays after the mic is off, so it is never recorded). **Vibrate on start and stop** controls the haptics. **Play the sounds** previews them. **Speech language** lets you pick one language for better accuracy; **Auto-detect** (the default) handles mixed speech such as Hinglish.

### Write in another language

On **Dictation → Write in**, pick a language such as English and Flow writes every dictation in it, whatever language you spoke. Leave it on **As I speak** to keep the spoken language. Translating uses the cleanup model, so it adds a moment, and it works even when cleanup is None (that case runs at Light). The Windows app has the same setting and the same prompt rule.

### Edit by voice

Select text in any field, tap the mic, and say what to do: "make this shorter", "fix the grammar", "translate to Hindi", "turn this into a list". The status reads **Say what to change**, and the selection is replaced with the rewrite. Say **delete that** to undo. If the model fails or answers with something that is not an edit, your text is left alone. Turn off **Dictation → Edit by voice → Rewrite selected text** if you would rather dictate over a selection. This is the Windows Command Mode, using the same prompt.

### Hands-free

Tap the mic once to start and again to finish, or hold it and release. Both work in every field.

### Keep the mic alive on strict phones

Open **Permissions → Keep the mic alive**. It shows whether Android lets Flow run in the background, opens the system screen to allow it, and lists the exact steps for your phone's brand (vivo, Xiaomi, Oppo, Samsung, Huawei and others).

## 5. Make it sound like you

These match the Windows app. Cleanup, Hindi and style are on **Writing style**; tones, dictionary and snippets are on **Words and tone**.

- **Auto cleanup** sets how much Flow edits after transcription, for every app. **None** pastes the raw transcript. **Auto** leaves clean speech alone and uses a light edit only when needed. **Light** removes fillers, repeats and false starts and fixes grammar with minimal rewriting. **Medium** also rewords tangled phrases. The choice saves as soon as you tap it.
- **Hindi** chooses how spoken Hindi is written. **Hinglish (Roman)** is the default: when you speak Hindi, Flow types it in English letters, like "main kal office jaunga" or "kya haal hai", and keeps any English words as English. **Devanagari** types Hindi in Devanagari instead. Speech that is entirely English stays English, and other languages are written as you speak them. This works with every cleanup level, including None, which makes only the script change. The choice saves as soon as you tap it.
- **Default app tone** and **tone by app**: Casual, Professional, Literal or Code. Add apps one per line as `package=tone`, for example `com.whatsapp=casual`. The most recent text field's package is shown to copy from.
- **Dictionary**: names and terms to always spell exactly, one per line. Add an optional note after a bar, like `Spring Boot | Java framework`; the note is passed to the cleanup model, as on the Windows app.
- **Snippets**: `my email => me@example.com`, one per line.
- **Writing style**: a short description of how you write. **Draft my style** reads two or three pieces of your own writing (separated by a blank line), sends them to Google once, and writes the style paragraph for you to edit. The samples are not kept.
- Tap the **Save** button on a page after editing its text boxes. Cleanup and Hindi save as soon as you tap them.

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
