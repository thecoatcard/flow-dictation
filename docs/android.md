# Flow for Android (debug build)

Flow uses a floating mic alongside your regular Android keyboard. In an eligible text field, the bubble appears at the screen edge. Tap to start, tap again to finish, or hold to record until release. Drag it to move it; it snaps to the nearest edge. It fades after five idle seconds and hides when the keyboard closes. It never records merely because a field gained focus.

This interaction follows [Wispr Flow's Android guide](https://docs.wisprflow.ai/articles/5906198129-starting-your-first-dictation-on-android): a bubble beside the existing keyboard, tap or hold dictation, automatic hiding outside text entry, and a five-minute session cap. Flow uses its own Gemini key and cleanup settings; Wispr's private transcription and cleanup implementation is unavailable.

## Build and install

Install Android Studio, or JDK 17 and Android SDK platform 35 with Build Tools 35. From PowerShell:

```powershell
cd apps/android
.\gradlew.bat testDebugUnitTest assembleDebug lintDebug
adb install -r .\app\build\outputs\apk\debug\app-debug.apk
```

Open **Flow** and grant **Microphone**, **Display over other apps**, and **Accessibility → Flow text insertion**. Save your Google Gemini API key, then press **Test API connection**. This tests the cleanup request and Live transcription setup without recording. Press **Show floating mic**, open a text field in another app, and tap or hold the bubble. The app does not need to become your default keyboard.

If upgrading from the earlier keyboard prototype, select your preferred keyboard in Android's keyboard settings once. The new Flow build no longer provides a keyboard.

Flow records immediately while the Live connection opens, buffering up to seven seconds so the beginning of speech is kept. Audio is sent as 16 kHz mono PCM. A five-minute cap submits automatically, with a warning one minute beforehand. The bubble stays visible during processing. Password, numeric and phone fields are excluded. The target field, text and cursor must still match before insertion. If they do not, the result is copied to the clipboard for manual paste. **Copy last dictation** is also available in Flow's settings while the bubble service is running.

The API key is encrypted with Android Keystore and app backups are disabled. Audio and transcripts are not logged or stored. Network access is required. Cleanup failure uses the raw transcript. The debug APK uses the local debug signing key; it is not a Play Store release.

## Device checks still needed

No phone or emulator was attached during this build. Verify overlay and Accessibility setup, real Gemini Live audio, tap and hold starts, release while connecting, five-minute auto-submit, drag, clipboard fallback, and insertion in several apps on a physical device. Some custom editors may reject Android's Accessibility text action. Manufacturer battery controls can stop a background service; reopen Flow and start the bubble again if that happens.
