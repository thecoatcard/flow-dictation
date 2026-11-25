import { contextBridge, ipcRenderer } from 'electron';

/** What the card window is told to show: an answer from Ask, or the reminder at the front of the queue. */
interface AnswerCardData {
  kind: 'answer' | 'reminder';
  question: string;
  answer: string;
  /** Reminder only: when it is due, and its place in the queue. */
  meta?: string;
  up: boolean;
  originX: number;
}

contextBridge.exposeInMainWorld('flowApi', {
  audio: {
    onStart: (cb: (deviceId?: string) => void) =>
      ipcRenderer.on('audio:start', (_e, deviceId?: string) => cb(deviceId)),
    onStop: (cb: () => void) => ipcRenderer.on('audio:stop', () => cb()),
    onList: (cb: () => void) => ipcRenderer.on('audio:list', () => cb()),
    onCue: (cb: (kind: string) => void) =>
      ipcRenderer.on('audio:cue', (_e, kind: string) => cb(kind)),
    devices: (list: unknown) => ipcRenderer.send('audio:devices', list),
    sendChunk: (chunk: ArrayBuffer) => ipcRenderer.send('audio:chunk', chunk),
    started: () => ipcRenderer.send('audio:started'),
    stopped: () => ipcRenderer.send('audio:stopped'),
    failed: (message: string) => ipcRenderer.send('audio:failed', message),
  },
  overlay: {
    onStatus: (cb: (s: { state: string; message?: string }) => void) =>
      ipcRenderer.on('overlay:status', (_e, s) => cb(s)),
    onLevel: (cb: (v: number) => void) => ipcRenderer.on('overlay:level', (_e, v) => cb(v)),
    interactive: (on: boolean) => ipcRenderer.send('overlay:interactive', on),
    dragStart: () => ipcRenderer.send('overlay:drag-start'),
    drag: (dx: number, dy: number) => ipcRenderer.send('overlay:drag', { dx, dy }),
    dragEnd: () => ipcRenderer.send('overlay:drag-end'),
    click: () => ipcRenderer.send('overlay:click'),
    hover: (on: boolean) => ipcRenderer.send('overlay:hover', on),
  },
  answer: {
    onShow: (cb: (d: AnswerCardData) => void) => ipcRenderer.on('answer:show', (_e, d) => cb(d)),
    onFade: (cb: () => void) => ipcRenderer.on('answer:fade', () => cb()),
    interactive: (on: boolean) => ipcRenderer.send('answer:interactive', on),
    hover: (on: boolean) => ipcRenderer.send('answer:hover', on),
    dragStart: (rect: { left: number; top: number; width: number; height: number }) =>
      ipcRenderer.send('answer:drag-start', rect),
    drag: (dx: number, dy: number) => ipcRenderer.send('answer:drag', { dx, dy }),
    dragEnd: () => ipcRenderer.send('answer:drag-end'),
    reminderDone: () => ipcRenderer.send('reminder:done'),
    reminderSnooze: () => ipcRenderer.send('reminder:snooze'),
    onSpeechEnd: (cb: () => void) => ipcRenderer.on('answer:speech-end', () => cb()),
    copy: () => ipcRenderer.send('answer:copy'),
    speak: () => ipcRenderer.send('answer:speak'),
    stop: () => ipcRenderer.send('answer:stop'),
    close: () => ipcRenderer.send('answer:close'),
  },
  settings: {
    recordDebug: (seconds: number) => ipcRenderer.invoke('debug:record', seconds),
    permissions: () => ipcRenderer.invoke('permissions:check'),
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: unknown) => ipcRenderer.invoke('settings:set', patch),
    setKey: (key: string) => ipcRenderer.invoke('key:set', key),
    clearKey: () => ipcRenderer.invoke('key:clear'),
    testKey: () => ipcRenderer.invoke('key:test'),
    listMics: () => ipcRenderer.invoke('mics:list'),
    learnStyle: (samples: string[]) => ipcRenderer.invoke('style:learn', samples),
    exportPersonal: () => ipcRenderer.invoke('personal:export'),
    importPersonal: () => ipcRenderer.invoke('personal:import'),
    onLevel: (cb: (v: number) => void) => ipcRenderer.on('mic:level', (_e, v) => cb(v)),
    usage: () => ipcRenderer.invoke('usage:get'),
    getPersonal: () => ipcRenderer.invoke('personal:get'),
    setPersonal: (patch: unknown) => ipcRenderer.invoke('personal:set', patch),
    openPermission: (name: string) => ipcRenderer.send('permissions:open', name),
    testCue: () => ipcRenderer.invoke('cue:test'),
    startKeyTest: () => ipcRenderer.invoke('keytest:start'),
    onKeyTest: (cb: (e: { type: string; at: number }) => void) =>
      ipcRenderer.on('keytest:event', (_e, p) => cb(p)),
    getMemory: () => ipcRenderer.invoke('memory:get'),
    removeNote: (id: string) => ipcRenderer.invoke('memory:remove-note', id),
    removeReminder: (id: string) => ipcRenderer.invoke('memory:remove-reminder', id),
    listHistory: (query: string) => ipcRenderer.invoke('history:list', query),
    copyHistory: (id: string) => ipcRenderer.invoke('history:copy', id),
    removeHistory: (id: string) => ipcRenderer.invoke('history:remove', id),
    clearHistory: () => ipcRenderer.invoke('history:clear'),
    correctHistory: (id: string, text: string) => ipcRenderer.invoke('history:correct', id, text),
    getUpdate: () => ipcRenderer.invoke('update:get'),
    checkUpdate: () => ipcRenderer.invoke('update:check'),
    installUpdate: () => ipcRenderer.invoke('update:install'),
    onUpdate: (cb: (s: unknown) => void) => ipcRenderer.on('update:status', (_e, s) => cb(s)),
    onPage: (cb: (page: string) => void) => ipcRenderer.on('settings:page', (_e, p) => cb(p)),
  },
});
