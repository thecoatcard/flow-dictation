export type Tone = 'casual' | 'professional' | 'literal' | 'code';
export type CleanupLevel = 'none' | 'auto' | 'light' | 'medium';
/** How spoken Hindi is written: Roman letters ("Hinglish") or Devanagari. English and other languages are untouched. */
export type HindiOutput = 'hinglish' | 'devanagari';

export interface DictionaryEntry {
  term: string;
  hint?: string;
}

export interface Snippet {
  trigger: string;
  expansion: string;
}

export type Mode = 'hold' | 'toggle';

/** Per-device behaviour. Empty string = platform default / system default. */
export interface AppSettings {
  hotkey: string;
  mode: Mode;
  micDeviceId: string;
  autostart: boolean;
  /** Most recently dictated-into apps (normalized ids), newest first. */
  recentApps: string[];
  /** Live transcription price in USD per audio hour, for the cost estimate. */
  sttUsdPerHour: number;
  /** Save the final text of each dictation on this PC so it can be searched and copied later. */
  keepHistory: boolean;
  /** Hold this combination, say what to do, and the selected text is rewritten. '' turns it off. */
  commandHotkey: string;
  /** A short tone when recording starts and stops. */
  soundCues: boolean;
  /** Mute the PC's sound output while recording, then restore it (Windows). */
  muteWhileDictating: boolean;
  /** Floating icon: always on screen, or only while dictating. */
  overlay: 'always' | 'active';
  /** Where the user dragged the floating icon (window origin); null = default spot. */
  overlayPos: { x: number; y: number } | null;
}

export interface FlowConfig {
  version: 1;
  app: AppSettings;
  models: { stt: string; cleanup: string };
  dictionary: DictionaryEntry[];
  /** App id (process name / bundle id, lowercase) -> tone. */
  appTones: Record<string, Tone>;
  defaultTone: Tone;
  /** How much the cleanup model may edit; None bypasses it entirely. */
  cleanupLevel: CleanupLevel;
  hindiOutput: HindiOutput;
  snippets: Snippet[];
  /** Free-text description of how the user writes. */
  style: string;
}

export const CONFIG_VERSION = 1;
export const MAX_RECENT_APPS = 20;
const TONES: readonly Tone[] = ['casual', 'professional', 'literal', 'code'];

export function defaultConfig(): FlowConfig {
  return {
    version: CONFIG_VERSION,
    app: {
      hotkey: '',
      mode: 'hold',
      micDeviceId: '',
      autostart: false,
      recentApps: [],
      sttUsdPerHour: 0.54,
      keepHistory: true,
      commandHotkey: 'Ctrl+Alt+E',
      soundCues: true,
      muteWhileDictating: false,
      overlay: 'always',
      overlayPos: null,
    },
    models: { stt: 'gemini-3.5-transcribe-live', cleanup: 'gemini-3.5-flash-lite' },
    dictionary: [],
    appTones: {},
    defaultTone: 'casual',
    cleanupLevel: 'light',
    hindiOutput: 'hinglish',
    snippets: [],
    style: '',
  };
}

const isTone = (v: unknown): v is Tone => TONES.includes(v as Tone);
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Turn any stored/imported JSON into a valid current-version config. Unknown fields are dropped. */
export function migrateConfig(raw: unknown): FlowConfig {
  const out = defaultConfig();
  if (!isObj(raw)) return out;

  if (isObj(raw.app)) {
    const a = raw.app;
    if (typeof a.hotkey === 'string') out.app.hotkey = a.hotkey;
    if (a.mode === 'hold' || a.mode === 'toggle') out.app.mode = a.mode;
    if (typeof a.micDeviceId === 'string') out.app.micDeviceId = a.micDeviceId;
    if (typeof a.autostart === 'boolean') out.app.autostart = a.autostart;
    if (typeof a.sttUsdPerHour === 'number' && a.sttUsdPerHour >= 0 && a.sttUsdPerHour < 1000)
      out.app.sttUsdPerHour = a.sttUsdPerHour;
    if (typeof a.keepHistory === 'boolean') out.app.keepHistory = a.keepHistory;
    if (typeof a.commandHotkey === 'string') out.app.commandHotkey = a.commandHotkey;
    if (typeof a.soundCues === 'boolean') out.app.soundCues = a.soundCues;
    if (typeof a.muteWhileDictating === 'boolean')
      out.app.muteWhileDictating = a.muteWhileDictating;
    if (a.overlay === 'always' || a.overlay === 'active') out.app.overlay = a.overlay;
    if (isObj(a.overlayPos)) {
      const { x, y } = a.overlayPos;
      if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x + y))
        out.app.overlayPos = { x: Math.round(x), y: Math.round(y) };
    }
    if (Array.isArray(a.recentApps))
      out.app.recentApps = a.recentApps
        .filter((x): x is string => typeof x === 'string' && !!x)
        .slice(0, MAX_RECENT_APPS);
  }
  if (isObj(raw.models)) {
    if (typeof raw.models.stt === 'string' && raw.models.stt) out.models.stt = raw.models.stt;
    if (typeof raw.models.cleanup === 'string' && raw.models.cleanup)
      out.models.cleanup = raw.models.cleanup;
  }
  if (Array.isArray(raw.dictionary)) {
    for (const e of raw.dictionary) {
      if (isObj(e) && typeof e.term === 'string' && e.term.trim()) {
        out.dictionary.push({
          term: e.term.trim(),
          ...(typeof e.hint === 'string' && e.hint ? { hint: e.hint } : {}),
        });
      }
    }
  }
  if (isObj(raw.appTones)) {
    for (const [app, tone] of Object.entries(raw.appTones)) {
      if (isTone(tone) && normalizeAppId(app)) out.appTones[normalizeAppId(app)] = tone;
    }
  }
  if (isTone(raw.defaultTone)) out.defaultTone = raw.defaultTone;
  if (
    raw.cleanupLevel === 'none' ||
    raw.cleanupLevel === 'auto' ||
    raw.cleanupLevel === 'light' ||
    raw.cleanupLevel === 'medium'
  )
    out.cleanupLevel = raw.cleanupLevel;
  if (raw.hindiOutput === 'hinglish' || raw.hindiOutput === 'devanagari')
    out.hindiOutput = raw.hindiOutput;
  if (Array.isArray(raw.snippets)) {
    for (const s of raw.snippets) {
      if (
        isObj(s) &&
        typeof s.trigger === 'string' &&
        s.trigger.trim() &&
        typeof s.expansion === 'string'
      ) {
        out.snippets.push({ trigger: s.trigger.trim(), expansion: s.expansion });
      }
    }
  }
  if (typeof raw.style === 'string') out.style = raw.style;
  return out;
}

/** Process name / bundle id -> stable key: lowercase, no ".exe". */
export function normalizeAppId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, '');
}

export function resolveTone(config: FlowConfig, appId?: string): Tone {
  return (appId && config.appTones[normalizeAppId(appId)]) || config.defaultTone;
}

/** Move an app to the front of the recent list (deduplicated, capped). */
export function rememberApp(recent: string[], appId: string): string[] {
  const id = normalizeAppId(appId);
  return id ? [id, ...recent.filter((r) => r !== id)].slice(0, MAX_RECENT_APPS) : recent;
}
