# Contributing to Flow

Thanks for helping. Flow is a push-to-talk dictation app for Windows (Electron) and Android (Kotlin) that talks straight to the Gemini API. Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first.

## Ways to help

- **Report a bug** or **suggest a feature** with an [issue](https://github.com/thecoatcard/flow-dictation/issues/new/choose). Say which app (Windows or Android), its version, and what you expected to happen.
- **Report a security problem** privately, as described in [SECURITY.md](SECURITY.md). Do not open a public issue for it.
- **Send a pull request.** For anything bigger than a small fix, open an issue first so we agree on the approach.

Never paste a real API key, audio or personal text into an issue or pull request.

## Project layout

| Path | What it is |
| --- | --- |
| `packages/core` | Shared TypeScript logic: cleanup prompt, segments, guard, config, usage, backup format. |
| `apps/desktop` | The Windows app (Electron). |
| `apps/android` | The Android app (Kotlin). |
| `docs` | Guides, including [the Android guide](docs/android.md). |

The Android cleanup prompt is a port of `packages/core/src/prompt.ts`. If you change the desktop prompt, regenerate `apps/android/app/src/test/resources/cleanup-prompts.txt` and update the Kotlin port so that `CleanupPromptTest` passes.

## Set up and test

Desktop and core, with Node.js and pnpm:

```powershell
pnpm install
pnpm test
pnpm typecheck
pnpm lint
```

Android, with JDK 17 and the Android SDK (platform 35). Newer JDKs do not work with Gradle 8.9:

```powershell
cd apps/android
.\gradlew.bat testDebugUnitTest assembleDebug lintDebug
```

See [docs/android.md](docs/android.md) for installing the APK on a phone.

## Pull requests

- Keep each pull request focused on one change, and describe what changed and why.
- Add or update tests when behaviour changes, and make sure the tests, typecheck and lint pass.
- Match the existing style. Run `pnpm format` for TypeScript.
- Do not commit secrets, build output (`dist`, `release`, `node_modules`) or signing keys.
- Keep idle battery use in mind: no polling, and the microphone and network are used only while dictating.

By contributing you agree that your contribution is licensed under the project's [MIT License](LICENSE).
