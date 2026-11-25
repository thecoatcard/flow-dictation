/** API exposed by preload.ts to every renderer. */
interface DebugRecordResult {
  ok: boolean;
  text?: string;
  error?: string;
  finalizeMs?: number;
  timedOut?: boolean;
}

interface PermissionRowDto {
  name: string;
  status: 'ok' | 'missing' | 'manual';
  help: string;
}

interface SettingsDto {
  app: {
    hotkey: string;
    mode: 'hold' | 'toggle';
    micDeviceId: string;
    autostart: boolean;
    sttUsdPerHour: number;
    keepHistory: boolean;
    commandHotkey: string;
    guideDismissed: boolean;
    keyTested: boolean;
    micChecked: boolean;
    tipsSeen: boolean;
    useWindowContext: boolean;
    soundCues: boolean;
    muteWhileDictating: boolean;
    overlay: 'always' | 'active';
    overlayPos: { x: number; y: number } | null;
  };
  hotkeys: Array<{ id: string; label: string }>;
  hasKey: boolean;
  secureStorage: boolean;
  packaged: boolean;
}

type Tone = 'casual' | 'professional' | 'literal' | 'code';
type CleanupLevel = 'none' | 'auto' | 'light' | 'medium';
type HindiOutput = 'hinglish' | 'devanagari';

interface PersonalDto {
  dictionary: Array<{ term: string; hint?: string }>;
  appTones: Record<string, Tone>;
  defaultTone: Tone;
  cleanupLevel: CleanupLevel;
  hindiOutput: HindiOutput;
  snippets: Array<{ trigger: string; expansion: string }>;
  style: string;
  recentApps: string[];
}

interface HistoryEntryDto {
  id: string;
  at: string;
  app: string;
  text: string;
}

interface UpdateStatusDto {
  state: 'idle' | 'checking' | 'downloading' | 'ready' | 'uptodate' | 'error' | 'unavailable';
  version: string;
  latest?: string;
  percent?: number;
  message?: string;
}

interface UsageDto {
  month: string;
  totals: { audioSeconds: number; inputTokens: number; outputTokens: number; dictations: number };
  cost: { stt: number; cleanup: number; total: number };
}

declare const flowApi: {
  audio: {
    onStart(cb: (deviceId?: string) => void): void;
    onStop(cb: () => void): void;
    onList(cb: () => void): void;
    onCue(cb: (kind: string) => void): void;
    devices(list: Array<{ id: string; label: string }>): void;
    sendChunk(chunk: ArrayBuffer): void;
    started(): void;
    stopped(): void;
    failed(message: string): void;
  };
  overlay: {
    onStatus(cb: (s: { state: string; message?: string }) => void): void;
    onLevel(cb: (v: number) => void): void;
    interactive(on: boolean): void;
    dragStart(): void;
    drag(dx: number, dy: number): void;
    dragEnd(): void;
    click(): void;
  };
  settings: {
    recordDebug(seconds: number): Promise<DebugRecordResult>;
    permissions(): Promise<PermissionRowDto[]>;
    get(): Promise<SettingsDto>;
    set(patch: Partial<SettingsDto['app']>): Promise<SettingsDto>;
    setKey(key: string): Promise<{ ok: boolean; error?: string }>;
    clearKey(): Promise<void>;
    testKey(): Promise<{ ok: boolean; message: string }>;
    listMics(): Promise<Array<{ id: string; label: string }>>;
    learnStyle(samples: string[]): Promise<{ ok: boolean; style?: string; error?: string }>;
    exportPersonal(): Promise<{ ok: boolean }>;
    importPersonal(): Promise<{ ok: boolean; error?: string; personal?: PersonalDto }>;
    onLevel(cb: (v: number) => void): void;
    usage(): Promise<UsageDto>;
    getPersonal(): Promise<PersonalDto>;
    setPersonal(patch: Partial<PersonalDto>): Promise<PersonalDto>;
    openPermission(name: string): void;
    testCue(): Promise<void>;
    startKeyTest(): Promise<void>;
    onKeyTest(cb: (e: { type: 'down' | 'up'; at: number }) => void): void;
    listHistory(query: string): Promise<HistoryEntryDto[]>;
    copyHistory(id: string): Promise<boolean>;
    removeHistory(id: string): Promise<void>;
    clearHistory(): Promise<void>;
    correctHistory(id: string, text: string): Promise<string[]>;
    getUpdate(): Promise<UpdateStatusDto>;
    checkUpdate(): Promise<void>;
    installUpdate(): Promise<void>;
    onUpdate(cb: (s: UpdateStatusDto) => void): void;
    onPage(cb: (page: string) => void): void;
  };
};
