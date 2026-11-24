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
