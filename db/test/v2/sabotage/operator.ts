// Red-proofs of a new operator's enrolment (ENROL1: test/v2/core/platform/operator-enrolment.test.ts and the console's
// apps/web/test/console.test.tsx), the console key on live (CONFIG1, packages/config) and vercel-env's --with-console
// (VERCEL-ENV1, test/v2/deploy/vercel-env.test.ts), and the console kept unlinked and unindexed (UNLINKED1,
// apps/web/test/unlinked.test.ts; ROBOTS1, test/v2/core/boot/robots.test.ts). Each breaks one protection; the named
// test must then fail.
import type { Case } from './case.ts';
import { mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FOUNDER = 'test/v2/core/platform/operator-enrolment.test.ts';
const WALK = 'a new operator is enrolled through the CLI: an identity, a proposal and an approval by the seed’s operator with fresh codes, each secret only in a 0600 file; then signs in with password and code';
const REFUSED = 'refused: a subject with a shop membership at the approval, a code from outside the window, and a code used twice; nothing is enrolled and no file is written';
const CONSOLE = 'the console proposes an operator and lists it waiting, refuses to approve the addition itself, and the operator the CLI enrols signs in to the console';
const LIVE_KEY = 'the console’s platform key is optional on demo, required on live, and at least 32 characters when given';
const UNLINKED = 'no page, layout, nav, footer, sitemap or manifest of the product site, /app, /demo, /developers or the shop sites links to /platform';
const WAY_OUT = "the console's nav links out to the site's home and to /app";
const ROBOTS = '/platform and every path under it carry X-Robots-Tag noindex, nofollow, served or refused at boot; no other path does';
const VERCEL_ENV ='the console key goes only with --with-console, which also needs sign-in’s two secrets; a live deployment needs the flag; migrator and channel settings never go';

const IDENTITY = 'db/src/platform-identity.ts';
const CLI = 'db/src/platform-cli.ts';
const ts = (sabotage: string, test: string, file: string, from: string, to: string): Case => ({ sabotage, file: FOUNDER, test, config: V2, ts: { file, from, to } });

export const OP_CASES: Case[] = [
  // the identity's subject printed to the terminal
  ts('v2-enrol-identity-stdout', WALK, IDENTITY, "io.out('next: an existing operator proposes it:", "io.out(subject);\n    io.out('next: an existing operator proposes it:"),
  // the identity's file left readable by others
  ts('v2-enrol-identity-mode', WALK, IDENTITY, 'chmodSync(out, 0o600);', 'chmodSync(out, 0o644);'),
  // the new operator's authenticator URI printed by the approval
  ts('v2-enrol-approve-stdout', WALK, CLI, "io.out('authenticator app, then delete the file; the URI cannot be shown again.');",
    "io.out('authenticator app, then delete the file; the URI cannot be shown again.');\n      io.out(approval.enrolment.otpauthUri);"),
  // the enrolment file left readable by others
  ts('v2-enrol-approve-mode', WALK, CLI, 'chmodSync(enrolOut, 0o600);', 'chmodSync(enrolOut, 0o644);'),
  // the hosted seed's file without the subject the CLI's --subject takes
  ts('v2-enrol-seed-subject', WALK, 'db/src/dev.ts', 'otpauth: seeded.otpauthUri, subject: seeded.subject,', 'otpauth: seeded.otpauthUri,'),
  // the hosted seeds' operator left unnamed (hosted.ts's own options, which the walk seeds with)
  ts('v2-enrol-hosted-name', WALK, 'db/seed/hosted.ts', "({ ...secrets, out, displayName: 'Demo operator' })", '({ ...secrets, out }) as DevOperator'),
  // a shop member's identity admitted as an operator
  {
    sabotage: 'v2-enrol-member',
    file: FOUNDER,
    test: REFUSED,
    config: V2,
    sql: mutate('platform.platform_guard()', "and s.subject = r ->> 'subject' and s.memberships > 0) then", 'and false) then'),
  },
  // a code two steps old accepted
  ts('v2-enrol-stale-code', REFUSED, 'packages/core/src/platform-totp.ts', 'for (const step of [nowStep + 1, nowStep, nowStep - 1])', 'for (const step of [nowStep + 1, nowStep, nowStep - 1, nowStep - 2])'),
  // a code accepted twice
  ts('v2-enrol-code-twice', REFUSED, 'packages/core/src/platform.ts', 'if (used.rowCount !== 1) return false;', ''),
  // the console approves an operator addition itself (its URI then shown nowhere)
  {
    sabotage: 'v2-enrol-console-approves',
    file: 'test/console.test.tsx',
    test: CONSOLE,
    dir: 'apps/web',
    config: 'vitest.config.ts',
    ts: { file: 'apps/web/app/platform/actions.ts', from: 'if (addsOperator(await changeDiff(c, id))) {', to: 'if (false && addsOperator(await changeDiff(c, id))) {' },
  },
  // the console's operator form proposes nothing
  {
    sabotage: 'v2-enrol-console-no-form',
    file: 'test/console.test.tsx',
    test: CONSOLE,
    dir: 'apps/web',
    config: 'vitest.config.ts',
    ts: { file: 'apps/web/app/platform/actions.ts', from: 'case "operator":', to: 'case "operator-unused":' },
  },
  // live boots without the console's key
  {
    sabotage: 'v2-config-live-console-key',
    file: 'test/config.test.ts',
    test: LIVE_KEY,
    dir: 'packages/config',
    config: 'vitest.config.ts',
    ts: {
      file: 'packages/config/src/index.ts',
      from: "const signInKeys = ['MUNSHI_IDENTITY_SECRET', 'MUNSHI_RATE_SECRET', 'MUNSHI_PLATFORM_SECRET'];",
      to: "const signInKeys = ['MUNSHI_IDENTITY_SECRET', 'MUNSHI_RATE_SECRET'];",
    },
  },
  // the console's key sent without the flag
  {
    sabotage: 'v2-vercel-env-console-always',
    file: 'test/v2/deploy/vercel-env.test.ts',
    test: VERCEL_ENV,
    config: V2,
    ts: { file: 'deploy/vercel-env.ts', from: '  if (withConsole) {', to: '  if (true) {' },
  },
  // a live deployment set up without its console key
  {
    sabotage: 'v2-vercel-env-live-without',
    file: 'test/v2/deploy/vercel-env.test.ts',
    test: VERCEL_ENV,
    config: V2,
    ts: { file: 'deploy/vercel-env.ts', from: "} else if (production.MUNSHI_DEPLOYMENT === 'live') {", to: '} else if (false) {' },
  },
  // --with-console sends a key whose sign-in cannot work: only the console key checked
  {
    sabotage: 'v2-vercel-env-console-signin',
    file: 'test/v2/deploy/vercel-env.test.ts',
    test: VERCEL_ENV,
    config: V2,
    ts: { file: 'deploy/vercel-env.ts', from: "[CONSOLE, 'MUNSHI_IDENTITY_SECRET', 'MUNSHI_RATE_SECRET']", to: '[CONSOLE]' },
  },
  // harness-level: a footer link to the console planted in the scanned text of components/Foot.tsx
  { sabotage: 'v2-unlinked-planted', file: 'test/unlinked.test.ts', test: UNLINKED, dir: 'apps/web', config: 'vitest.config.ts' },
  // the console's nav without its way back to the site
  {
    sabotage: 'v2-unlinked-no-way-out',
    file: 'test/unlinked.test.ts',
    test: WAY_OUT,
    dir: 'apps/web',
    config: 'vitest.config.ts',
    ts: { file: 'apps/web/components/platform/Console.tsx', from: '  ["/app", "The app"],\n', to: '' },
  },
  // the console's paths served without the robots tag
  {
    sabotage: 'v2-robots-untagged',
    file: 'test/v2/core/boot/robots.test.ts',
    test: ROBOTS,
    config: V2,
    ts: { file: 'apps/web/proxy.ts', from: 'if (CONSOLE.test(request.nextUrl.pathname)) response.headers.set', to: 'if (false) response.headers.set' },
  },
];
