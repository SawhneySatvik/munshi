// Two source scans over the code that ships (BLUEPRINT §4.3, §4.5): nothing reads a file under .run/ at run time (a
// deployed app has no .run/; pnpm dev passes its generated secrets in as environment variables), and nothing writes to
// the console but packages/core/src/log.ts, the one module that writes structured lines. Comments are blanked first:
// prose about .run/ is not a read. Red-proofs (a planted line joins the scanned text): test/v2/sabotage/core-boot.ts.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { sabotageIs } from '../../sabotage/index.ts';

const ROOT = path.join(import.meta.dirname, '..', '..', '..', '..', '..');
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
// Not shipped: tests and their configs, the screenshot and probe scripts, recorded fixtures, build output.
const SKIP = new Set(['node_modules', '.next', 'dist', 'coverage', 'test', 'scripts', 'fixtures', '.screenshots']);
const NOT_SHIPPED = /(\.test\.tsx?|^vitest\.config\.ts)$/;
const LOG = 'packages/core/src/log.ts';

type Src = { file: string; text: string };

function walk(rel: string): Src[] {
  const abs = path.join(ROOT, rel);
  if (statSync(abs).isFile()) return CODE.test(rel) && !NOT_SHIPPED.test(path.basename(rel)) ? [{ file: rel, text: readFileSync(abs, 'utf8') }] : [];
  return readdirSync(abs).flatMap((name) => (SKIP.has(name) ? [] : walk(path.join(rel, name))));
}

// Every app (its pages, routes, components, lib and root files such as proxy.ts) and every package (its src, or its
// root where it has none: the adapters keep channels/ and identity/ there).
const shipped = (): Src[] => [
  ...readdirSync(path.join(ROOT, 'apps')).flatMap((a) => walk(`apps/${a}`)),
  ...readdirSync(path.join(ROOT, 'packages')).flatMap((p) => walk(`packages/${p}`)),
];

// Comments blanked; strings and template literals kept as written (a quote inside a regex literal can only keep a
// comment, which errs towards a false alarm).
export function uncomment(t: string): string {
  let out = '';
  for (let i = 0; i < t.length; ) {
    const c = t[i] as string;
    if (c === '/' && (t[i + 1] === '/' || t[i + 1] === '*')) {
      const end = t[i + 1] === '/' ? t.indexOf('\n', i) : t.indexOf('*/', i + 2) + 2;
      const j = end < i + 2 ? t.length : end;
      out += t.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < t.length && t[j] !== c) j += t[j] === '\\' ? 2 : 1;
      out += t.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const RUN_READ = /(?<![\w$.])\.run(?=[/"'`])/;
const CONSOLE = /\bconsole\s*\??\.\s*[A-Za-z]/;

const hits = (srcs: Src[], re: RegExp) =>
  srcs.flatMap(({ file, text }) => uncomment(text).split('\n').flatMap((line, i) => (re.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])));

function scanned(sabotage: string, planted: Src): Src[] {
  const srcs = shipped();
  // The scan must cover the hosting layer it guards and the shared packages.
  for (const f of ['apps/web/proxy.ts', 'apps/web/lib/server/config.ts', 'apps/web/lib/server/db.ts', 'apps/web/app/api/health/route.ts', 'packages/config/src/index.ts', LOG, 'packages/agent/src/index.ts', 'packages/ai/src/index.ts', 'packages/adapters/identity/index.ts']) {
    expect(srcs.map((s) => s.file)).toContain(f);
  }
  expect(srcs.some((s) => s.file.includes('/test/') || s.file.includes('/scripts/'))).toBe(false);
  return sabotageIs(sabotage) ? [...srcs, planted] : srcs;
}

it('SCAN-RUN no shipped file reads a file under .run/ at run time', () => {
  // The detector: each way of naming .run/ is a hit; a .run() call, a property and a comment are not.
  const probe = (text: string) => hits([{ file: 'probe.ts', text }], RUN_READ).length;
  for (const read of ['path.join(root, ".run", "session-secret")', "readFileSync('.run/demo-tenant')", 'const f = root + "/.run/dev.env";', 'join(root, `.run`)']) {
    expect(probe(read), read).toBe(1);
  }
  for (const not of ['store.run(ctx, fn)', 'x.run', '// the secrets under .run/', '/* see .run/dev.env */ const a = 1;', 'path.join(a, ".runner")']) {
    expect(probe(not), not).toBe(0);
  }
  const srcs = scanned('v2-boot-scan-run', { file: 'apps/web/lib/server/planted.ts', text: 'export const secret = readFileSync(path.join(repoRoot(), ".run", "session-secret"));' });
  expect(hits(srcs, RUN_READ)).toEqual([]);
});

it('SCAN-CONSOLE nothing that ships writes to the console but packages/core/src/log.ts', () => {
  const probe = (text: string) => hits([{ file: 'probe.ts', text }], CONSOLE).length;
  for (const call of ['console.log(x)', 'console.error("x")', 'console . warn(x)', 'console?.info(x)']) expect(probe(call), call).toBe(1);
  for (const not of ['// console.log(x)', 'const consoleish = 1;', '"see the console"']) expect(probe(not), not).toBe(0);
  const srcs = scanned('v2-boot-scan-console', { file: 'apps/web/app/planted.ts', text: 'export function f() { console.log("a value"); }' });
  // log.ts is the one exception, and it does write to the console: the scanner sees it.
  expect(hits(srcs.filter((s) => s.file === LOG), CONSOLE).length).toBeGreaterThan(0);
  expect(hits(srcs.filter((s) => s.file !== LOG), CONSOLE)).toEqual([]);
});
