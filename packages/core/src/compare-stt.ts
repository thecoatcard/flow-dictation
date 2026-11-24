/**
 * Compare Live STT models on the same clips.
 *   GEMINI_API_KEY=... pnpm --filter @flow/core compare-stt -- clip1.wav clip2.wav \
 *     [--models gemini-3.5-transcribe-live,gemini-3.8-live] [--usd-per-min 0.00]
 * Clips: 16 kHz mono PCM16 WAV. Word error is judged by eye (printed side by side).
 * Audio is sent at real-time pace, like a user speaking.
 */
import { readFileSync } from 'node:fs';
import { geminiLiveConnect, SttSession } from './stt';

const CHUNK_BYTES = 3200; // 100 ms of 16 kHz PCM16

function parseArgs(argv: string[]) {
  const clips: string[] = [];
  let models = ['gemini-3.5-transcribe-live'];
  let usdPerMin = 0;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--models') models = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (argv[i] === '--usd-per-min') usdPerMin = Number(argv[++i]);
    else if (argv[i] !== '--') clips.push(argv[i]);
  }
  return { clips, models, usdPerMin };
}

function pcmFromWav(path: string): Buffer {
  const b = readFileSync(path);
  if (
    b.toString('ascii', 0, 4) !== 'RIFF' ||
    b.readUInt32LE(24) !== 16000 ||
    b.readUInt16LE(22) !== 1
  )
    throw new Error(`${path}: need 16 kHz mono PCM16 WAV`);
  const at = b.indexOf('data', 12, 'ascii');
  if (at < 0) throw new Error(`${path}: no data chunk`);
  return b.subarray(at + 8);
}

async function main() {
  const key = process.env.GEMINI_API_KEY;
  const { clips, models, usdPerMin } = parseArgs(process.argv.slice(2));
  if (!key || !clips.length) {
    console.error(
      'Usage: GEMINI_API_KEY=... pnpm --filter @flow/core compare-stt -- a.wav b.wav [--models m1,m2]',
    );
    process.exit(1);
  }
  for (const clip of clips) {
    const pcm = pcmFromWav(clip);
    const minutes = pcm.length / 2 / 16000 / 60;
    console.log(`\n== ${clip} (${(minutes * 60).toFixed(1)} s)`);
    for (const model of models) {
      const stt = new SttSession(geminiLiveConnect(key, model));
      try {
        for (let o = 0; o < pcm.length; o += CHUNK_BYTES) {
          stt.pushAudio(pcm.subarray(o, o + CHUNK_BYTES));
          await new Promise((r) => setTimeout(r, 100));
        }
        const r = await stt.finish();
        const cost = usdPerMin ? ` cost~$${(minutes * usdPerMin).toFixed(5)}` : '';
        console.log(
          `[${model}] finalize ${r.finalizeMs} ms${r.timedOut ? ' (TIMED OUT)' : ''}${cost}\n  ${r.text}`,
        );
      } catch (e) {
        console.log(`[${model}] ERROR ${e instanceof Error ? e.message : e}`);
      }
    }
  }
}

void main();
