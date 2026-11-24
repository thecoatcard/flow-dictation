# Security policy

Flow handles a Google Gemini API key, microphone audio and, on Android, Accessibility access, so security reports are taken seriously.

## Supported versions

Only the latest [release](https://github.com/thecoatcard/flow-dictation/releases/latest) receives fixes. Both the Windows and the Android builds are early previews.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

1. Go to the repository's **Security** tab and choose **Report a vulnerability**. This opens a private report only the maintainer can see.
2. Describe what you found, the steps to reproduce it, the app and version (Windows or Android) and what an attacker could do with it.
3. Never include a real API key or personal audio in a report.

You can expect an acknowledgement within a few days and an update when a fix is planned. Please give the maintainer reasonable time to fix the problem before you disclose it publicly.

## Scope

In scope: the Windows app, the Android app, and the code in this repository, for example key storage, what is logged or sent over the network, text insertion, and the build and release files.

Out of scope: Google's own services and APIs, Android or Windows platform bugs, and attacks that need a device that is already compromised.

## What Flow does with your data

- Your API key is encrypted on the device (Windows credential encryption; Android Keystore) and is never written to the settings file or logs.
- Audio goes directly from your device to Google's Gemini API, only while you dictate. Flow has no server of its own.
- Audio and transcripts are not logged or stored by Flow.
