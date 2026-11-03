// Red-proofs of the hosting layer (test/v2/core/boot/): each breaks one protection of the config module, the boot check,
// the request hook, next.config's headers and compiled schema sha, the log module, health or pnpm dev's environment,
// and its named test must fail. The two source
// scans are harness-level: a planted line joins the scanned text.
import type { Case } from './case.ts';

const V2 = 'vitest.v2.config.ts';
const DIR = 'test/v2/core/boot';
const CONFIG = 'packages/config/src/index.ts';
const DB = 'apps/web/lib/server/db.ts';
const PROXY = 'apps/web/proxy.ts';
const NEXT_CONFIG = 'apps/web/next.config.ts';
const LOG = 'packages/core/src/log.ts';
const DEV = 'db/src/dev.ts';

const SET = 'boot refuses a missing required setting, naming it and never printing a value';
const DEPLOY = 'boot refuses a MUNSHI_DEPLOYMENT that is not ops.deployment (no row counts as demo)';
const BUILD = "boot expects the build's schema sha: next.config compiles in readSchema()'s, and no environment variable stands in for it";
const DEV_ENV = 'pnpm dev gives next dev every setting boot requires, each pool as its own role, and writes none of them out';
const SCHEMA = "boot refuses a database whose ops.schema_version.sha256 is not the checked-out db/schema's, or that has none";
const ROLE = (pool: string, role: string) => `the ${pool} pool must connect as ${role}`;
const CLAUSES = 'a superuser, a BYPASSRLS role or a member of munshi_owner is refused even under the right name';
const WIRE = 'while boot refuses, the request hook answers 503 with the code and no route runs; health reports the code';
const REDACT_ERRORS = 'a planted secret never reaches an error of config or boot, the refusal the hook or health answers, or a log line';
const REDACT_LOG = 'a log line carries only its fixed fields: a planted secret in any of them is dropped, never written';
const SCAN_RUN = 'no shipped file reads a file under .run/ at run time';
const SCAN_CONSOLE = 'nothing that ships writes to the console but packages/core/src/log.ts';
const HDR = 'every route under apps/web/app, and an unknown one, gets the security headers and its CSP: pages a nonce policy, handlers and media none';
const REQID = "every response carries x-request-id, passed to the route too: Vercel's id when well-formed, else a fresh uuid, never the client's";
const HEALTH = "/api/health reports ok, the deployment, the schema sha's first 12 hex characters and the modes; never a secret or a count";

const ts = (sabotage: string, file: string, test: string, source: string, from: string, to: string): Case => ({
  sabotage,
  file: `${DIR}/${file}`,
  test,
  config: V2,
  ts: { file: source, from, to },
});

const BUILT = "typeof MUNSHI_BUILD_SCHEMA_SHA256 === 'string' ? MUNSHI_BUILD_SCHEMA_SHA256 : undefined;";
const ROLE_CHECK = 'if (roleRefused(ROLES[pool], me)) throw new BootError("wrong_role", pool);';
const ROLE_CLAUSES = 'me?.role !== expected || me.superuser || me.bypass || me.owner';
const POOL_ROLES = [
  ['app', 'munshi_app'],
  ['jobs', 'munshi_jobs'],
  ['agent', 'munshi_agent'],
  ['platform', 'munshi_platform'],
  ['public', 'munshi_public'],
  ['idp', 'munshi_idp'],
] as const;

export const CORE_BOOT_CASES: Case[] = [
  // a missing setting is not named as missing (it falls through to the validity check)
  ts('v2-boot-set', 'boot.test.ts', SET, CONFIG, 'const missing = Object.keys(REQUIRED).filter((name) => !env[name]);', 'const missing: string[] = [];'),
  ts('v2-boot-deploy', 'boot.test.ts', DEPLOY, DB, 'if ((found.kind ?? "demo") !== s.deployment) throw new BootError("wrong_deployment");', ''),
  ts('v2-boot-schema', 'boot.test.ts', SCHEMA, DB, 'if (found.sha !== built) throw new BootError("stale_schema");', ''),
  // the expected sha taken from the environment: at build time, or at run time when no build value is there, or over it
  ts('v2-boot-build-from-env', 'boot.test.ts', BUILD, NEXT_CONFIG, 'MUNSHI_BUILD_SCHEMA_SHA256: readSchema().sha256', 'MUNSHI_BUILD_SCHEMA_SHA256: process.env.MUNSHI_SCHEMA_SHA256 ?? ""'),
  ts('v2-boot-build-env-fallback', 'boot.test.ts', BUILD, CONFIG, BUILT, "typeof MUNSHI_BUILD_SCHEMA_SHA256 === 'string' ? MUNSHI_BUILD_SCHEMA_SHA256 : process.env.MUNSHI_SCHEMA_SHA256;"),
  ts('v2-boot-build-env-override', 'boot.test.ts', BUILD, CONFIG, BUILT, `process.env.MUNSHI_SCHEMA_SHA256 || (${BUILT.slice(0, -1)});`),
  // one pool's role left unchecked
  ...POOL_ROLES.map(([pool, role]) => ts(`v2-boot-role-${pool}`, 'boot.test.ts', ROLE(pool, role), DB, ROLE_CHECK, `if (pool !== "${pool}" && roleRefused(ROLES[pool], me)) throw new BootError("wrong_role", pool);`)),
  ts('v2-boot-role-superuser', 'boot.test.ts', CLAUSES, DB, ROLE_CLAUSES, 'me?.role !== expected || me.bypass || me.owner'),
  ts('v2-boot-role-bypass', 'boot.test.ts', CLAUSES, DB, ROLE_CLAUSES, 'me?.role !== expected || me.superuser || me.owner'),
  ts('v2-boot-role-owner', 'boot.test.ts', CLAUSES, DB, ROLE_CLAUSES, 'me?.role !== expected || me.superuser || me.bypass'),
  // the hook serves while boot refuses
  ts('v2-boot-wire', 'boot.test.ts', WIRE, PROXY, '    await boot();\n', ''),
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the replacement source text, not a template
  ts('v2-boot-redact-config', 'redact.test.ts', REDACT_ERRORS, CONFIG, 'if (!valid(env[name] as string)) invalid.push(name);', 'if (!valid(env[name] as string)) invalid.push(`${name}=${env[name]}`);'),
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the replacement source text, not a template
  ts('v2-boot-redact-boot', 'redact.test.ts', REDACT_ERRORS, DB, 'throw new BootError("unreachable", pool);', 'throw new Error(`boot: unreachable ${url}`);'),
  ts('v2-boot-redact-log', 'redact.test.ts', REDACT_LOG, LOG, 'if (SHAPES[key](value)) line[key] = value;', 'if (true) line[key] = value;'),
  { sabotage: 'v2-boot-scan-run', file: `${DIR}/scan.test.ts`, test: SCAN_RUN, config: V2 },
  { sabotage: 'v2-boot-scan-console', file: `${DIR}/scan.test.ts`, test: SCAN_CONSOLE, config: V2 },
  // the CSP dropped from the response, or from the request Next renders (which then signs no script with the nonce)
  ts('v2-boot-no-csp', 'headers.test.ts', HDR, PROXY, '  response.headers.set("content-security-policy", csp);\n  return response;', '  return response;'),
  ts('v2-boot-no-request-csp', 'headers.test.ts', HDR, PROXY, '    headers.set("content-security-policy", csp);\n    response = ', '    response = '),
  // media served under the page policy
  ts('v2-boot-icon-csp', 'headers.test.ts', HDR, PROXY, 'const DATA = /^\\/(api(\\/.*)?|icon\\.svg|favicon\\.ico)$/;', 'const DATA = /^\\/(api(\\/.*)?|favicon\\.ico)$/;'),
  // the docs' matcher, which leaves the API routes without the hook
  ts('v2-boot-matcher', 'headers.test.ts', HDR, PROXY, 'matcher: ["/((?!_next/static|_next/image|', 'matcher: ["/((?!api|_next/static|_next/image|'),
  ts('v2-boot-no-nosniff', 'headers.test.ts', HDR, NEXT_CONFIG, '{ key: "X-Content-Type-Options", value: "nosniff" },', ''),
  ts('v2-boot-no-request-id', 'headers.test.ts', REQID, PROXY, '  response.headers.set("x-request-id", requestId);\n', ''),
  ts('v2-boot-client-request-id', 'headers.test.ts', REQID, PROXY, 'const vercel = request.headers.get("x-vercel-id");', 'const vercel = request.headers.get("x-request-id") ?? request.headers.get("x-vercel-id");'),
  ts('v2-boot-health-sha', 'health.test.ts', HEALTH, DB, 'schema: found.sha.slice(0, 12),', 'schema: found.sha,'),
  // pnpm dev leaves out the sixth pool, or writes a secret out while it builds the environment
  ts('v2-boot-dev-env-missing', 'dev-env.test.ts', DEV_ENV, DEV, "    IDP_DATABASE_URL: as('munshi_idp'),\n", ''),
  ts('v2-boot-dev-env-logged', 'dev-env.test.ts', DEV_ENV, DEV, '    CRON_SECRET: secrets.cron,\n', '    CRON_SECRET: (console.log(secrets.cron), secrets.cron),\n'),
];
