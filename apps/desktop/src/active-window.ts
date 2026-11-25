import { normalizeAppId } from '@flow/core';
import { foregroundProcessName, foregroundWindowTitle } from './win-foreground';

// active-win is ESM-only and this app compiles to CommonJS, so load it with a real dynamic import.
const importEsm = new Function('m', 'return import(m)') as (m: string) => Promise<{
  activeWindow(
    o?: object,
  ): Promise<{ title?: string; owner: { name: string; bundleId?: string } } | undefined>;
}>;

async function activeWinWindow() {
  const { activeWindow } = await importEsm('active-win');
  // false: never trigger macOS permission prompts just to read the app name.
  const w = await activeWindow({
    accessibilityPermission: false,
    screenRecordingPermission: false,
  });
  return w;
}

async function viaActiveWin(): Promise<string | undefined> {
  const w = await activeWinWindow();
  return w ? (w.owner.bundleId ?? w.owner.name) : undefined;
}

/** Title of the focused window, if known. Only ever sent to the cleanup model, to help spell names. */
export async function activeWindowTitle(): Promise<string | undefined> {
  try {
    const title =
      process.platform === 'win32' ? foregroundWindowTitle() : (await activeWinWindow())?.title;
    return title?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Normalized id of the focused app (process name on Windows, bundle id on macOS), if known.
 * Windows uses Win32 directly: active-win's Windows addon is compiled at install time and is
 * absent here, so it silently returns nothing.
 */
export async function activeAppId(): Promise<string | undefined> {
  try {
    const raw = process.platform === 'win32' ? foregroundProcessName() : await viaActiveWin();
    return raw ? normalizeAppId(raw) || undefined : undefined;
  } catch {
    return undefined;
  }
}
