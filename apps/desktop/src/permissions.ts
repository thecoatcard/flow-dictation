import { shell, systemPreferences } from 'electron';

export interface PermissionRow {
  name: string;
  status: 'ok' | 'missing' | 'manual';
  help: string;
}

const MAC_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_';

export function checkPermissions(): PermissionRow[] {
  const mic = systemPreferences.getMediaAccessStatus('microphone');
  const rows: PermissionRow[] = [
    {
      name: 'Microphone',
      status: mic === 'granted' ? 'ok' : 'missing',
      help: 'Needed to hear you while the hotkey is held.',
    },
  ];
  if (process.platform === 'darwin') {
    rows.push(
      {
        name: 'Accessibility',
        status: systemPreferences.isTrustedAccessibilityClient(false) ? 'ok' : 'missing',
        help: 'Needed to press Cmd+V for you.',
      },
      {
        name: 'Input Monitoring',
        status: 'manual',
        help: 'Needed to see the hotkey. macOS cannot report this: if the hotkey does nothing, enable Flow here.',
      },
    );
  }
  return rows;
}

export function openPermissionSettings(name: string): void {
  const win: Record<string, string> = { Microphone: 'ms-settings:privacy-microphone' };
  const mac: Record<string, string> = {
    Microphone: `${MAC_PANE}Microphone`,
    Accessibility: `${MAC_PANE}Accessibility`,
    'Input Monitoring': `${MAC_PANE}ListenEvent`,
  };
  const url = (process.platform === 'darwin' ? mac : win)[name];
  if (url) void shell.openExternal(url);
}
