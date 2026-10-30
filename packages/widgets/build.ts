// Builds the widgets into the one file the app serves: apps/web/public/widgets/munshi-order.js, a classic script (an
// IIFE, no imports, no third-party code: the SDK and the widget only). `node build.ts --check` exits 1 when the committed
// file is not a fresh build (test/build.test.ts runs the same comparison).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.join(HERE, '..', '..', 'apps', 'web', 'public', 'widgets', 'munshi-order.js');

export async function bundle(): Promise<string> {
  const r = await build({
    // The bundle's path comments are relative to this folder, wherever the build is run from.
    absWorkingDir: HERE,
    entryPoints: [path.join(HERE, 'src', 'index.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    minify: false,
    legalComments: 'none',
    charset: 'utf8',
    banner: { js: '// <munshi-order>: built from packages/widgets (node packages/widgets/build.ts). Do not edit.' },
  });
  return (r.outputFiles[0] as { text: string }).text;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fresh = await bundle();
  if (process.argv.includes('--check')) {
    let onDisk = '';
    try {
      onDisk = readFileSync(OUT, 'utf8');
    } catch {}
    if (onDisk !== fresh) {
      console.error('widgets: apps/web/public/widgets/munshi-order.js is not a fresh build: run node packages/widgets/build.ts');
      process.exit(1);
    }
  } else {
    writeFileSync(OUT, fresh);
    console.log(`widgets: wrote ${path.relative(process.cwd(), OUT)} (${fresh.length} bytes)`);
  }
}
