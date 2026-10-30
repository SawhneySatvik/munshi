// Red-proofs of the deploy kit (BP-OPS-1): the deploy check (test/v2/deploy/deploy-check.test.ts), the demo's channel
// boot check (packages/config), and the capture guard (test/v2/deploy/capture-guard.test.ts). Each breaks one
// protection, and its named test must fail. The apps/web marker scan is harness-level: a planted file joins the scan.
import type { Case } from './case.ts';

const V2 = 'vitest.v2.config.ts';
const CHECK = 'db/src/deploy-check.ts';
const GUARD = 'scripts/capture-guard.ts';
const CHECK_TEST = 'test/v2/deploy/deploy-check.test.ts';
const GUARD_TEST = 'test/v2/deploy/capture-guard.test.ts';

const MISSING = 'DEPLOY1 deploy-check refuses a missing URL or MUNSHI_DEPLOYMENT, naming each';
const SHARED = 'DEPLOY1 deploy-check refuses two variables sharing a URL or a password';
const LOGIN =
  'DEPLOY1 deploy-check refuses a superuser, the migrator or another role behind a pool URL, the app behind the migrator URL, and a wrong password, printing only codes';
const CHANNEL = 'DEPLOY1 deploy-check refuses a demo config that names a channel credential, by name and never by value';
const BUILD = 'DEPLOY1 deploy-check refuses a database whose deployment row is missing, of the other kind, hosted = false, live from the schema, or another build';
const SUPA = 'SUPA1 deploy-check refuses anon, authenticated, service_role or another BYPASSRLS role reaching a Munshi schema or table, the Data API exposing one, and a Munshi object in public';
const CONFIG_CHANNEL = 'CONFIG1 a demo deployment names no channel credential: any WhatsApp or Instagram setting refuses boot by name, never by value';
const ENV_PRESENCE = 'ENVPRESENCE1 reports only names and set or unset, never a planted value';

const check = (sabotage: string, test: string, from: string, to: string): Case => ({ sabotage, file: CHECK_TEST, test, config: V2, ts: { file: CHECK, from, to } });
const guard = (sabotage: string, test: string, from: string, to: string): Case => ({ sabotage, file: GUARD_TEST, test, config: V2, ts: { file: GUARD, from, to } });

const ORIGIN_CHECK = 'if (appOrigins.has(new URL(url).origin)) {';

export const DEPLOY_CASES: Case[] = [
  {
    sabotage: 'v2-env-presence-prints-value',
    file: 'test/v2/deploy/env-presence.test.ts',
    test: ENV_PRESENCE,
    config: V2,
    ts: {
      file: 'packages/config/src/index.ts',
      from: "return names.map((name) => `${name}: ${env[name] ? 'set' : 'unset'}`).join('\\n');",
      to: "return names.map((name) => `${name}: ${env[name] ? 'set' : 'unset'} ${env[name] ?? ''}`).join('\\n');",
    },
  },
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text to break, not a template
  check('v2-deploy-missing-url', MISSING, 'for (const name of names) if (!env[name]) problems.push(`${name} is not set`);', ''),
  check('v2-deploy-missing-deployment', MISSING, "if (env.MUNSHI_DEPLOYMENT !== 'demo' && env.MUNSHI_DEPLOYMENT !== 'live') problems.push", 'if (false) problems.push'),
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text to break, not a template
  check('v2-deploy-shared-url', SHARED, 'if (env[a] === env[b]) problems.push(`${a} and ${b} are the same URL: each role has its own login`);\n      else ', ''),
  check('v2-deploy-shared-password', SHARED, "else if (password(env[a] as string) !== '' && password(env[a] as string) === password(env[b] as string))", 'else if (false)'),
  check('v2-deploy-wrong-login', LOGIN, 'if (w.me !== expected) problems.push', 'if (false) problems.push'),
  check('v2-deploy-superuser', LOGIN, 'if (w.super) problems.push', 'if (false) problems.push'),
  check('v2-deploy-member-of-owner', LOGIN, "if (name !== 'MIGRATOR_DATABASE_URL' && w.member_of_owner)", 'if (false)'),
  // a failed connection's problem carries the URL it was given
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text to break, not a template
  check('v2-deploy-prints-url', LOGIN, 'problems.push(`${name}: cannot connect (${errorCode(err)})`);', 'problems.push(`${name}: cannot connect (${errorCode(err)}) ${env[name]}`);'),
  check('v2-deploy-demo-channel', CHANNEL, "if (env.MUNSHI_DEPLOYMENT === 'demo' && channels.length) problems.push", 'if (false) problems.push'),
  check('v2-deploy-no-row', BUILD, "if (found.rows === 0) problems.push('ops.deployment has no row", "if (false) problems.push('ops.deployment has no row"),
  check('v2-deploy-kind', BUILD, 'if (found.kind !== env.MUNSHI_DEPLOYMENT) problems.push', 'if (false) problems.push'),
  check('v2-deploy-hosted', BUILD, 'if (found.hosted === false) problems.push', 'if (false) problems.push'),
  check('v2-deploy-live-source', BUILD, "if (found.kind === 'live' && found.source !== 'migrations') problems.push", 'if (false) problems.push'),
  check('v2-deploy-stale', BUILD, 'if (found.sha !== schemaSha) problems.push', 'if (false) problems.push'),
  check('v2-deploy-supa-roles', SUPA, 'for (const r of reach) problems.push', 'for (const r of reach.slice(0, 0)) problems.push'),
  check('v2-deploy-supa-bypass', SUPA, 'where (r.rolname = any($1::text[]) or r.rolbypassrls)', 'where (r.rolname = any($1::text[]))'),
  check('v2-deploy-data-api', SUPA, 'if (exposed.length) problems.push', 'if (false) problems.push'),
  check('v2-deploy-public-object', SUPA, 'if ((pub[0]?.n ?? 0) > 0) problems.push', 'if (false) problems.push'),
  {
    sabotage: 'v2-config-demo-channel',
    file: 'test/config.test.ts',
    test: CONFIG_CHANNEL,
    dir: 'packages/config',
    config: 'vitest.config.ts',
    ts: { file: 'packages/config/src/index.ts', from: "if (env.MUNSHI_DEPLOYMENT === 'demo' && channels.length) throw", to: 'if (false) throw' },
  },
  // MERCHANTS-DESIGN §8.3's four red-proofs, then the scan.
  guard('v2-capture-site-app-page', "CAPTURE1 --mode site refuses an app page: its origin is one of the app deploys", ORIGIN_CHECK, 'if (false) {'),
  guard('v2-capture-site-live-marker', "CAPTURE1 --mode site refuses a page on the live app's origin even with the marker planted", ORIGIN_CHECK, 'if (false) {'),
  guard(
    'v2-capture-app-no-health',
    'CAPTURE1 --mode app refuses a site page, and the live app: neither origin has /api/health saying demo',
    "return res.ok && body.ok === true && body.deployment === 'demo';",
    'return true;',
  ),
  guard(
    'v2-capture-app-live-class',
    'CAPTURE1 --mode app refuses a demo page carrying data-class="live" or none, and a tenant off the allow-list or of another class',
    "const DEMO_CLASSES = ['synthetic', 'showcase'];",
    "const DEMO_CLASSES = ['synthetic', 'showcase', 'live'];",
  ),
  guard('v2-capture-site-state', 'CAPTURE1 --mode site refuses a site page with no marker or in a request state', "if ('data-state' in", 'if (false && '),
  guard('v2-capture-cli-exit', 'CAPTURE1 the CLI exits 1 on any refusal, 2 without a mode, and 0 when every page passes', '    return 1;\n  }\n  io.out(', '  }\n  io.out('),
  ...(['v2-vercel-cron-path', 'v2-vercel-cron-hourly'] as const).map((sabotage) => ({
    sabotage,
    file: 'test/v2/deploy/vercel.test.ts',
    test: 'VERCEL1 the web project has one daily cron, on the tick route, which answers GET',
    config: V2,
  })),
  {
    sabotage: 'v2-capture-scan-web-marker',
    file: GUARD_TEST,
    test: 'CAPTURE1 only apps/sites may render the public-site marker: no source file under apps/web carries it',
    config: V2,
  },
];
