import { describe, expect, it } from 'vitest';
import { classifyError, friendlyMessage } from './errors';
import { processTranscript } from './pipeline';
import { defaultConfig, migrateConfig } from './config';

describe('classifyError', () => {
  it.each([
    [
      new Error('{"error":{"message":"API key not valid. Please pass a valid API key."}}'),
      'bad-key',
    ],
    [Object.assign(new Error('x'), { status: 403 }), 'bad-key'],
    [new Error('429 RESOURCE_EXHAUSTED'), 'quota'],
    [new Error('getaddrinfo ENOTFOUND generativelanguage.googleapis.com'), 'network'],
    [new TypeError('fetch failed'), 'network'],
    [new Error('boom'), 'other'],
  ])('%s -> %s', (e, kind) => {
    expect(classifyError(e)).toBe(kind);
  });

  it('gives a message for each kind', () => {
    expect(friendlyMessage(new Error('RESOURCE_EXHAUSTED'))).toMatch(/quota/i);
  });
});

describe('cleanup retry', () => {
  it('retries a transient failure once, not a bad key', async () => {
    let calls = 0;
    const flaky = {
      generate: async () => {
        if (calls++ === 0) throw new Error('fetch failed');
        return 'Hello.';
      },
    };
    expect(await processTranscript('hello', { config: defaultConfig(), client: flaky })).toEqual({
      kind: 'insert',
      text: 'Hello.',
    });
    expect(calls).toBe(2);

    let n = 0;
    const errs: unknown[] = [];
    const badKey = {
      generate: async () => {
        n++;
        throw new Error('API key not valid');
      },
    };
    const r = await processTranscript('hello', {
      config: defaultConfig(),
      client: badKey,
      onError: (e) => errs.push(e),
    });
    expect(r).toEqual({ kind: 'insert', text: 'hello' });
    expect(n).toBe(1);
    expect(errs).toHaveLength(1);
  });
});

describe('app settings migration', () => {
  it('keeps valid values and rejects bad ones', () => {
    const c = migrateConfig({
      app: { hotkey: 'F9', mode: 'toggle', micDeviceId: 5, autostart: true },
    });
    expect(c.app).toEqual({
      hotkey: 'F9',
      mode: 'toggle',
      micDeviceId: '',
      autostart: true,
      recentApps: [],
      sttUsdPerHour: 0.54,
      keepHistory: true,
      commandHotkey: 'Ctrl+Alt+E',
      useWindowContext: true,
      soundCues: true,
      muteWhileDictating: false,
      overlay: 'always',
      overlayPos: null,
    });
    expect(migrateConfig({ app: { mode: 'x' } }).app.mode).toBe('hold');
  });
});

describe('overlay settings migration', () => {
  it('keeps a valid position and mode, drops junk', () => {
    const ok = migrateConfig({ app: { overlay: 'active', overlayPos: { x: 10.4, y: 20 } } });
    expect(ok.app.overlay).toBe('active');
    expect(ok.app.overlayPos).toEqual({ x: 10, y: 20 });
    const bad = migrateConfig({ app: { overlay: 'x', overlayPos: { x: 'a', y: NaN } } });
    expect(bad.app.overlay).toBe('always');
    expect(bad.app.overlayPos).toBeNull();
  });
});
