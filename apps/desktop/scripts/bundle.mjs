// Bundles the main process (with @flow/core and @google/genai inlined) into dist/main.js, so the
// packaged app does not need workspace symlinks. Native/ESM-only modules stay external.
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';

const result = await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  external: ['electron', 'electron-updater', 'uiohook-napi', 'koffi', 'active-win'],
  logLevel: 'warning',
  // Written with node's fs: esbuild's own file writes fail with "Access is denied" on some Windows setups.
  write: false,
});
for (const f of result.outputFiles) writeFileSync(f.path, f.contents);
