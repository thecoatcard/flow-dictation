import type { LiveServerMessage } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { SttError, SttSession, type LiveConnect, type LiveHandlers } from './stt';

const msg = (c: LiveServerMessage['serverContent']): LiveServerMessage => ({ serverContent: c });

/** Fake socket: `script` runs when audioStreamEnd arrives. */
function fake(script: (h: LiveHandlers) => void, opts: { failConnects?: number } = {}) {
  const sent: unknown[] = [];
  let fails = opts.failConnects ?? 0;
  let closed = false;
  const connect: LiveConnect = async (h) => {
    if (fails-- > 0) throw new Error('refused');
    return {
      sendRealtimeInput: (p) => {
        sent.push(p);
        if (p.audioStreamEnd) setTimeout(() => script(h), 5);
      },
      close: () => {
        closed = true;
      },
    };
  };
  return { connect, sent, isClosed: () => closed };
}

describe('SttSession', () => {
  it('buffers audio sent before connect, concatenates finals, resolves on turnComplete', async () => {
    const f = fake((h) => {
      h.onmessage(msg({ interimInputTranscription: { text: 'hel' } }));
      h.onmessage(msg({ inputTranscription: { text: 'hello ' } }));
      h.onmessage(msg({ inputTranscription: { text: 'world' } }));
      h.onmessage(msg({ turnComplete: true }));
    });
    const s = new SttSession(f.connect);
    s.pushAudio(new Uint8Array([1, 2])); // before socket is ready
    const r = await s.finish();
    expect(r).toMatchObject({ text: 'hello world', timedOut: false });
    expect(f.sent).toHaveLength(2); // buffered audio + audioStreamEnd
    expect(f.isClosed()).toBe(true);
  });

  it('uses the interim text when the final never arrives (timeout)', async () => {
    const f = fake((h) =>
      h.onmessage(msg({ interimInputTranscription: { text: 'partial text' } })),
    );
    const r = await new SttSession(f.connect, { finalizeTimeoutMs: 50 }).finish();
    expect(r).toMatchObject({ text: 'partial text', timedOut: true });
  });

  it('accepts a late final that lands before turnComplete', async () => {
    const f = fake((h) => {
      h.onmessage(msg({ interimInputTranscription: { text: 'late' } }));
      setTimeout(() => {
        h.onmessage(msg({ inputTranscription: { text: 'late final' } }));
        h.onmessage(msg({ turnComplete: true }));
      }, 20);
    });
    expect((await new SttSession(f.connect).finish()).text).toBe('late final');
  });

  it('retries connect once, then fails with SttError', async () => {
    const ok = fake(
      (h) => h.onmessage(msg({ inputTranscription: { text: 'ok' }, turnComplete: true })),
      {
        failConnects: 1,
      },
    );
    expect((await new SttSession(ok.connect).finish()).text).toBe('ok');

    const bad = fake(() => undefined, { failConnects: 2 });
    await expect(new SttSession(bad.connect).finish()).rejects.toBeInstanceOf(SttError);
  });

  it('keeps text when the socket closes early, throws when there is none', async () => {
    const withText = fake((h) => {
      h.onmessage(msg({ inputTranscription: { text: 'kept' } }));
      h.onclose();
    });
    expect((await new SttSession(withText.connect).finish()).text).toBe('kept');

    const noText = fake((h) => {
      h.onerror(new Error('quota'));
    });
    await expect(new SttSession(noText.connect).finish()).rejects.toThrow(/quota/);
  });

  it('replaces instead of appending when the server sends the cumulative transcript', async () => {
    const f = fake((h) => {
      h.onmessage(msg({ inputTranscription: { text: 'hello' } }));
      h.onmessage(msg({ inputTranscription: { text: 'hello world' } }));
      h.onmessage(msg({ turnComplete: true }));
    });
    expect((await new SttSession(f.connect).finish()).text).toBe('hello world');
  });
});
