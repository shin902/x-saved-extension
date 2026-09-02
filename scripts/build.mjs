import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({
  entryPoints: {
    'service-worker': 'src/service-worker.ts',
    'content-script': 'src/content-script.ts',
    'popup': 'src/popup.ts'
  },
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  outdir: 'dist',
  sourcemap: true,
  logLevel: 'info'
});
await cp('src/manifest.json', 'dist/manifest.json');
await cp('src/popup.html', 'dist/popup.html');
await cp('src/popup.css', 'dist/popup.css');
