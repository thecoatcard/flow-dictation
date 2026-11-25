// Hidden renderer: mic -> 16 kHz mono PCM16 100 ms chunks -> main process.
(() => {
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;

  async function start(deviceId?: string): Promise<void> {
    await stop();
    const audio = (id?: string): MediaTrackConstraints => ({
      deviceId: id ? { exact: id } : undefined,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    });
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audio(deviceId) });
    } catch (e) {
      // Saved mic was unplugged: use the system default rather than failing.
      if (!deviceId || !(e instanceof DOMException) || e.name !== 'OverconstrainedError') throw e;
      stream = await navigator.mediaDevices.getUserMedia({ audio: audio() });
    }
    // A 16 kHz context makes the browser resample the mic for us.
    ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule('audio-worklet.js');
    const node = new AudioWorkletNode(ctx, 'pcm16-chunker');
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => flowApi.audio.sendChunk(e.data);
    ctx.createMediaStreamSource(stream).connect(node);
  }

  async function stop(): Promise<void> {
    // Stopping every track turns the OS mic indicator off.
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    await ctx?.close();
    ctx = null;
  }

  // Start and stop tones: a short two-note bell chime. Rising (G5 to D6) means "listening", falling
  // (D6 to G5) means "done". The first note is short and accented, the last slightly longer, in the
  // register where speakers are clearest, and the stop chime is a little softer than the start.
  let cueCtx: AudioContext | null = null;
  function bell(ctx: AudioContext, freq: number, at: number, len: number, peak: number): void {
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(peak, at + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, at + len + 0.09);
    env.connect(ctx.destination);
    // A fundamental plus two quiet overtones gives a soft bell rather than a bare beep.
    for (const [mult, amp] of [
      [1, 1],
      [2, 0.28],
      [3, 0.08],
    ] as const) {
      const osc = ctx.createOscillator();
      const part = ctx.createGain();
      part.gain.value = amp / 1.36;
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      osc.connect(part).connect(env);
      osc.start(at);
      osc.stop(at + len + 0.12);
    }
  }
  function cue(kind: string): void {
    cueCtx ??= new AudioContext();
    void cueCtx.resume();
    const t = cueCtx.currentTime + 0.01;
    if (kind === 'start') {
      bell(cueCtx, 784, t, 0.07, 0.34);
      bell(cueCtx, 1175, t + 0.075, 0.16, 0.3);
    } else {
      bell(cueCtx, 1175, t, 0.07, 0.27);
      bell(cueCtx, 784, t + 0.075, 0.16, 0.23);
    }
  }
  flowApi.audio.onCue(cue);

  flowApi.audio.onList(() => {
    void (async () => {
      try {
        // Labels are blank until the page has had mic access once.
        (await navigator.mediaDevices.getUserMedia({ audio: true }))
          .getTracks()
          .forEach((t) => t.stop());
      } catch {
        // fall through: list without labels
      }
      const all = await navigator.mediaDevices.enumerateDevices();
      flowApi.audio.devices(
        all
          .filter(
            (d) =>
              d.kind === 'audioinput' &&
              d.deviceId !== 'default' &&
              d.deviceId !== 'communications',
          )
          .map((d) => ({ id: d.deviceId, label: d.label || 'Microphone' })),
      );
    })();
  });
  flowApi.audio.onStart((deviceId) => {
    start(deviceId).then(
      () => flowApi.audio.started(),
      (e: unknown) => {
        void stop();
        flowApi.audio.failed(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      },
    );
  });
  flowApi.audio.onStop(() => {
    void stop().then(() => flowApi.audio.stopped());
  });
})();
