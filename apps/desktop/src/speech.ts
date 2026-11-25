import { spawn, type ChildProcess } from 'node:child_process';

/** Longest text read aloud in one go. Longer text is cut, so a stray paste cannot talk for minutes. */
const MAX_SPOKEN_CHARS = 5000;

let current: ChildProcess | null = null;

/** Stops whatever is being read. */
export function stopSpeaking(): void {
  current?.kill();
  current = null;
}

/**
 * Reads text aloud with the operating system's own voice: no network, no cost, no audio leaves the PC.
 * The text goes in through the environment (Windows) or stdin (macOS), never into a command line, so
 * it cannot be read as part of a command. Returns false where there is no system voice to use.
 */
export function speak(text: string, onEnd?: () => void): boolean {
  const spoken = text.trim().slice(0, MAX_SPOKEN_CHARS);
  if (!spoken) return false;
  stopSpeaking();
  let child: ChildProcess;
  if (process.platform === 'win32') {
    child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak($env:FLOW_SPEAK)',
      ],
      { env: { ...process.env, FLOW_SPEAK: spoken }, windowsHide: true, stdio: 'ignore' },
    );
  } else if (process.platform === 'darwin') {
    child = spawn('say', [], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.stdin?.end(spoken);
  } else {
    return false;
  }
  child.on('error', () => onEnd?.()); // no voice available: stay silent rather than crash
  child.on('exit', () => {
    if (current === child) current = null;
    onEnd?.();
  });
  current = child;
  return true;
}
