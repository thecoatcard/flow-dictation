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
    askHotkey: string;
    askUsesNotes: boolean;
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
  outputLanguage: string;
  smartFormatting: boolean;
  snippets: Array<{ trigger: string; expansion: string }>;
  style: string;
  recentApps: string[];
}

interface MemoryDto {
  notes: Array<{ id: string; text: string; at: string }>;
  reminders: Array<{
    id: string;
    text: string;
    due: string;
    repeat: 'none' | 'daily' | 'weekly';
    snoozedUntil?: string;
  }>;
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
    dragStart(): void;
    drag(dx: number, dy: number): void;
    dragEnd(): void;
    click(): void;
    pill(width: number): void;
    onWake(cb: () => void): void;
  };
  answer: {
    onShow(
      cb: (d: {
        kind: 'answer' | 'reminder';
        question: string;
        answer: string;
        meta?: string;
        up: boolean;
        parts?: Array<{ kind: 'text'; text: string } | { kind: 'code'; text: string; lang: string }>;
        originX: number;
      }) => void,
    ): void;
    onFade(cb: () => void): void;
    onPointer(cb: (inside: boolean) => void): void;
    onOrigin(cb: (o: { up: boolean; originX: number }) => void): void;
    rect(box: { left: number; top: number; width: number; height: number }): void;
    copyText(text: string): void;
    dragStart(rect: { left: number; top: number; width: number; height: number }): void;
    drag(dx: number, dy: number): void;
    dragEnd(): void;
    reminderDone(): void;
    reminderSnooze(): void;
    onSpeechEnd(cb: () => void): void;
    copy(): void;
    speak(): void;
    stop(): void;
    close(): void;
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
    getMemory(): Promise<MemoryDto>;
    removeNote(id: string): Promise<MemoryDto>;
    removeReminder(id: string): Promise<MemoryDto>;
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
