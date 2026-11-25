/* global AudioWorkletProcessor, registerProcessor */
// Runs on the audio thread. Context is created at 16 kHz, so no resampling is needed here.
// Emits mono PCM16 chunks of 1600 samples (100 ms).
const CHUNK = 1600;

class Pcm16Chunker extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Int16Array(CHUNK);
    this.n = 0;
    // On 'flush' the unfinished chunk is sent as-is, so the last <100 ms of speech is not lost.
    this.port.onmessage = () => {
      if (this.n) this.port.postMessage(this.buf.slice(0, this.n).buffer);
      this.n = 0;
    };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === CHUNK) {
        this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
        this.buf = new Int16Array(CHUNK);
        this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm16-chunker', Pcm16Chunker);
