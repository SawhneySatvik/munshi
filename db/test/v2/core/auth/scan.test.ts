// AUTH-SRC: a session reaches the app only through core's sign-in paths and sessionFrom, so no shipped
// file under apps/web opens a session itself (openSession, startSession, signUpSession, which take ids on trust), and
// only lib/server/session.ts builds the identity port, the one place its secret and the idp pool meet. Source text, with
// whole-line comments blanked. Under its sabotage a planted page joins the scan (harness-level), and the gate must fail.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { sabotageIs } from '../../sabotage/index.ts';

const ROOT = path.join(import.meta.dirname, '..', '..', '..', '..', '..');
const SKIP = new Set(['node_modules', '.next', '.screenshots', 'test', 'fixtures']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const at = path.join(dir, name);
    if (statSync(at).isDirectory()) return SKIP.has(name) ? [] : walk(at);
    return /\.(ts|tsx|mts|js|mjs|cjs)$/.test(name) ? [at] : [];
  });
}
const uncommented = (text: string) => text.replace(/^[ \t]*\/\/.*$/gm, '');

it('no web source opens a session itself, and only lib/server/session.ts builds the identity port', () => {
  const files = walk(path.join(ROOT, 'apps', 'web')).map((f) => ({ file: path.relative(ROOT, f), text: uncommented(readFileSync(f, 'utf8')) }));
  if (sabotageIs('v2-auth-web-mints')) {
    files.push({ file: 'apps/web/app/planted/page.tsx', text: `const s = await openSession(await appPool(), tenantId, memberId);` });
  }
  expect(files.length).toBeGreaterThan(100);
  const mints = files.filter((f) => /\b(openSession|startSession|signUpSession)\s*\(/.test(f.text)).map((f) => f.file);
  expect(mints, 'web files opening a session').toEqual([]);
  const ports = files.filter((f) => /\bpasswordIdentity\s*\(/.test(f.text)).map((f) => f.file);
  expect(ports).toEqual(['apps/web/lib/server/session.ts']);
});
