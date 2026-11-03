// Red-proofs of a real shop's way in (D-079, D-080; L-ON): the purge job and the pending skip (test/v2/core/jobs/
// signups.test.ts), and through the app the real sign-up, the waiting page's gate, the console's acceptance, the limits,
// the sample shops beside it and seed:hosted (apps/web/test/onboarding*.test.tsx). Each removes the one rule its gate
// names.
import type { Case } from './case.ts';

const V2 = 'vitest.v2.config.ts';
const db = (test: string, sabotage: string, file: string, from: string, to: string): Case => ({
  sabotage,
  file: 'test/v2/core/jobs/signups.test.ts',
  test,
  config: V2,
  ts: { file, from, to },
});
const web = (spec: string, test: string, sabotage: string, file: string, from: string, to: string): Case => ({
  sabotage,
  dir: 'apps/web',
  config: 'vitest.config.ts',
  file: `test/${spec}`,
  test,
  ts: { file, from, to },
});

const ON4 = 'ON4 the purge job erases a lapsed sign-up’s identity through the identity adapter and frees its slug for a new sign-up';
const ON4_UNWIRED = 'ON4 with identities to erase and no eraser wired, the purge fails and purges nothing';
const SKIP = 'ON-SKIP a real shop the operator has not accepted is skipped by the per-tenant jobs; accepted, it is not';
const ON1 = 'ON1 a real sign-up makes a pending real shop; its owner sees only the waiting page, and every /app page sends them there';
const ON3 = "ON3 a non-owner of a pending shop is refused with the sign-in's line, and so is the owner of an expired one: never a 500";
const ON2 = 'ON2 the console lists the shop waiting; accept is proposed, approved in a later request, audited, and opens /app with Getting started';
const ON2_EXPIRED = 'ON2-EXPIRED a sign-up past its two weeks is counted expired, never listed to accept, and an acceptance of it is refused at proposal';
const ON6 = 'ON6 a real sign-up is limited per network and per email, counted before any password is hashed';
const WORDS = 'ON-WORDS the onboarding words carry no digit, and the English no Devanagari';
const ON5 = "ON5 seed:hosted's kirana seeds Sharma on a hosted demo database through the owner role, and /demo/sharma-general-store opens its people";
const ON7_HOSTED = "ON7 a judge's sample shop signs up on the hosted demo as a sandbox";

const EMAIL1 = 'ON1-EMAIL with Supabase set, the form emails a link, its page spends nothing, and its post makes the shop with the email verified';
const EMAIL2 = 'ON1-EMAIL a link confirming another email, or one Supabase refuses, makes nothing';
const SUPA2 = 'SUPA2 verify spends the token hash and returns only a confirmed email; a refused, unconfirmed or malformed one is null';

const SIGNUPS = 'packages/core/src/jobs-signups.ts';
const ON = 'onboarding.test.tsx';
const HOSTED = 'onboarding-hosted.test.tsx';

export const ONBOARDING_CASES: Case[] = [
  // The purge never asks the adapter to erase: the identity outlives its shop.
  db(ON4, 'v2-on4-no-erase', SIGNUPS, 'for (const subject of passwords) await (erase as IdentityEraser)(subject);', ''),
  // With nothing wired, the purge commits anyway and orphans the identity.
  db(ON4_UNWIRED, 'v2-on4-unwired-purges', SIGNUPS, "if (passwords.length && !erase) throw new Error('jobs: lapsed sign-ups hold password identities and no identity eraser is wired');", 'if (!erase) return {};'),
  // Every directory tenant gets the per-tenant jobs, pending real shops too.
  db(SKIP, 'v2-on-skip-pending', 'packages/core/src/jobs.ts',
    'where not d.live or exists (select 1 from platform.tenant_acceptance a where a.tenant_id = d.tenant_id) order by d.tenant_id', 'order by d.tenant_id'),
  // A pending shop's cookie is an app session: the /app pages run for it.
  web(ON, ON1, 'v2-on1-pending-session', 'apps/web/lib/server/session.ts', 'return signedIn?.shop === "open" ? signedIn.session : null;', 'return signedIn?.session ?? null;'),
  // A real sign-up makes a sample shop.
  web(ON, ON1, 'v2-on1-class', 'packages/core/src/members.ts', "i.kind === 'real' ? 'live' : 'synthetic'", "'synthetic'"),
  // The database's "waiting for acceptance" is no longer a refusal core knows: the sign-in throws (a 500).
  web(ON, ON3, 'v2-on3-ms020-unknown', 'packages/core/src/errors.ts', "  MS020: 'refused',", '  MS999: \'refused\','),
  // An expired sign-up's owner gets the wrong-password line.
  web(ON, ON3, 'v2-on3-expired-line', 'apps/web/app/(auth)/actions.ts', '=== "expired" ? "/sign-in?expired=1" : "/sign-in?failed=1"', '=== "never" ? "/sign-in?expired=1" : "/sign-in?failed=1"'),
  // The acceptance is written outside the shop's context: the database refuses it, the shop stays pending.
  web(ON, ON2, 'v2-on2-no-context', 'packages/core/src/platform.ts', "    await c.query(`select set_config('munshi.tenant_id', $1, true)`, [ch.tenant_id]);\n", ''),
  // Home loses its Getting started.
  web(ON, ON2, 'v2-on2-no-checklist', 'apps/web/app/app/page.tsx', '      <GettingStarted done={start} />\n', ''),
  // The console reads every waiting sign-up as unexpired: a lapsed one is listed to accept.
  web(ON, ON2_EXPIRED, 'v2-on2-expired-listed', 'packages/core/src/onboarding.ts', 'select t.name, t.business_type, ops.tenant_lapsed(t.tenant_id) as lapsed,', 'select t.name, t.business_type, false as lapsed,'),
  // Only the network is counted, then only the email.
  web(ON, ON6, 'v2-on6-no-email-limit', 'apps/web/app/(site)/sign-up/actions.ts', 'return ip && mail;', 'return ip;'),
  web(ON, ON6, 'v2-on6-no-ip-limit', 'apps/web/app/(site)/sign-up/actions.ts', 'return ip && mail;', 'return mail;'),
  // Home's Getting started is no role's (the role map's screen, D-082): the owner of an accepted shop does not see it.
  web(ON, ON2, 'v2-on2-screen-unmapped', 'packages/core/src/read-roles.ts', "'screen.getting_started': office(),", "'screen.getting_started': { roles: [], cap: null },"),
  // The email path stamps the identity as self-asserted.
  web('onboarding-email.test.tsx', EMAIL1, 'v2-on1-email-unverified', 'apps/web/app/(site)/sign-up/actions.ts', 'ctx, "email"));', 'ctx, "invite"));'),
  // The confirmed email is not checked against the one the browser asked for.
  web('onboarding-email.test.tsx', EMAIL2, 'v2-on1-email-any', 'apps/web/app/(site)/sign-up/actions.ts', '  if (!pending.holds(email)) redirect(back("lost"));\n', ''),
  // Supabase's answer is taken without its confirmation.
  {
    sabotage: 'v2-supa2-unconfirmed',
    dir: 'packages/adapters',
    config: 'vitest.config.ts',
    file: 'test/supabase-email.test.ts',
    test: SUPA2,
    ts: { file: 'packages/adapters/identity/supabase-email.ts', from: "&& body.user?.email_confirmed_at ? email : null", to: '? email : null' },
  },
  // A digit in the English words.
  web(ON, WORDS, 'v2-on-words-digit', 'apps/web/lib/i18n-onboard.ts', 'last_day: "Less than a day left for approval.",', 'last_day: "Less than 1 day left for approval.",'),
  // seed:hosted's kirana ignores the owner's connection: the app's path, refused on a hosted database.
  web(HOSTED, ON5, 'v2-on5-app-path', 'db/seed/kirana.ts', 'const { session: owner, shopId } = opts.owner\n', 'const { session: owner, shopId } = false\n'),
  // A judge's sample shop is no sandbox: refused on a hosted database.
  web(HOSTED, ON7_HOSTED, 'v2-on7-not-sandbox', 'packages/core/src/logins.ts', "values ($1, $2, $3, 'synthetic', true)`", "values ($1, $2, $3, 'synthetic', false)`"),
];
