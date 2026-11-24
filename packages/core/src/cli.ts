import { GeminiCleanupClient, defaultConfig, processTranscript } from './index';

const key = process.env.GEMINI_API_KEY;
const text = process.argv.slice(2).join(' ');
if (!key || !text) {
  console.error('Usage: GEMINI_API_KEY=... pnpm cleanup "<transcript>"');
  process.exit(1);
}
const config = defaultConfig();
const client = new GeminiCleanupClient(key, config.models.cleanup);
void processTranscript(text, { config, client }).then((r) =>
  console.log(r.kind === 'insert' ? r.text : `[command: ${r.command}]`),
);
