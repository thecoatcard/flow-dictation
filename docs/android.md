# Flow for Android (phone test build)

Flow uses a floating mic alongside your regular Android keyboard. In an eligible text field, the bubble appears at the screen edge. Tap to start, tap again to finish, or hold to record until release. Drag it to move it; it snaps to the nearest edge. It fades after five idle seconds and hides when the keyboard closes. It never records merely because a field gained focus.

This interaction follows [Wispr Flow's Android guide](https://docs.wisprflow.ai/articles/5906198129-starting-your-first-dictation-on-android): a bubble beside the existing keyboard, tap or hold dictation, automatic hiding outside text entry, and a five-minute session cap. Flow uses its own Gemini key and cleanup settings; Wispr's private transcription and cleanup implementation is unavailable.

## Build and install

Install Android Studio, or JDK 17 and Android SDK platform 35 with Build Tools 35. From PowerShell:

```powershell
cd apps/android
.\gradlew.bat testDebugUnitTest assembleDebug lintDebug
adb install -r .\app\build\outputs\apk\debug\app-debug.apk
```

## If Play Protect blocks the copied APK

The APK is signed with a local Android **debug** certificate. It also needs Accessibility access to find the focused field and insert dictated text. Google Play Protect may block an unverified APK with sensitive access; changing the app name or certificate does not establish Play verification. Keep Play Protect enabled.

For development testing, connect your own phone to this computer with USB debugging enabled, accept its USB debugging prompt, and run `adb devices` to confirm it says `device`. Then use the `adb install -r` command above from this workspace. If `adb` is not on your PATH, use Android Studio's **Run** action with the phone selected. This installs the locally built debug package through the Android development workflow. It may still be refused by device policy or Play Protect; the approved distribution route is a Google Play internal test track, which requires a Play Console account and review of the app's Accessibility use.

On Android 13+, a sideloaded install may separately block the Accessibility toggle as a **restricted setting**. If you trust this build, Android's own path is **Settings → Apps → Flow → More → Allow restricted settings**, then return to Accessibility and enable Flow. Do not grant this access to an APK from an unknown source. If a previous Flow build was signed on another computer, `adb install -r` can fail with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`; install a build signed with the same key or uninstall the old build first (which removes its settings and saved key).

Open **Flow** and grant **Microphone**, **Display over other apps**, and **Accessibility → Flow text insertion**. Save your Google Gemini API key, then press **Test API connection**. This tests the cleanup request and Live transcription setup without recording. Press **Show floating mic**, open a text field in another app, and tap or hold the bubble. The app does not need to become your default keyboard.

If upgrading from the earlier keyboard prototype, select your preferred keyboard in Android's keyboard settings once. The new Flow build no longer provides a keyboard.

Flow records immediately while the Live connection opens, buffering up to seven seconds so the beginning of speech is kept. Audio is sent as 16 kHz mono PCM. A five-minute cap submits automatically, with a warning one minute beforehand. The bubble stays visible during processing. Password, numeric and phone fields are excluded. The target field, text and cursor must still match before insertion. If they do not, the result is copied to the clipboard for manual paste. **Copy last dictation** is also available in Flow's settings while the bubble service is running.

The API key is encrypted with Android Keystore and app backups are disabled. Audio and transcripts are not logged or stored. Network access is required. Cleanup failure uses the raw transcript. The debug APK uses the local debug signing key; it is not a Play Store release. Flow presents a separate explanation and consent step before opening Android's Accessibility settings.

## Device checks still needed

No phone or emulator was attached during this build. Verify overlay and Accessibility setup, real Gemini Live audio, tap and hold starts, release while connecting, five-minute auto-submit, drag, clipboard fallback, and insertion in several apps on a physical device. Some custom editors may reject Android's Accessibility text action. Manufacturer battery controls can stop a background service; reopen Flow and start the bubble again if that happens.
