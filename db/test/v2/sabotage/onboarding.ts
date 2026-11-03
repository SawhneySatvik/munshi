// Red-proofs of a real shop's way in: the purge job and the pending skip (test/v2/core/jobs/
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

const ON4 = 'the purge job erases a lapsed sign-up’s identity through the identity adapter and frees its slug for a new sign-up';
const ON4_UNWIRED = 'with identities to erase and no eraser wired, the shop is still purged, the slot fails and the identity stays queued';
const SKIP = 'a real shop the operator has not accepted is skipped by the per-tenant jobs; accepted, it is not';
const ON1 = 'a real sign-up makes a pending real shop; its owner sees only the waiting page, and every /app page sends them there';
const ON3 = "a non-owner of a pending shop is refused with the sign-in's line, and so is the owner of an expired one: never a 500";
const ON2 = 'the console lists the shop waiting; accept is proposed, approved in a later request, audited, and opens /app with Getting started';
const ON2_EXPIRED = 'a sign-up past its two weeks is counted expired, never listed to accept, and an acceptance of it is refused at proposal';
const ON6 = 'a real sign-up is limited per network and per email, counted before any password is hashed';
const WORDS = 'the onboarding words carry no digit, and the English no Devanagari';
const ON5 = "seed:hosted's kirana seeds Sharma on a hosted demo database through the owner role, and /demo/sharma-general-store opens its people";
const ON7_HOSTED = "a visitor's sample shop signs up on the hosted demo as a sandbox";

const EMAIL1 = 'with Supabase set, the form emails a link, its page spends nothing, and its post makes the shop with the email verified';
const EMAIL2 = 'a link confirming another email, or one Supabase refuses, makes nothing';
const SUPA2 = 'verify spends the token hash and returns only a confirmed email; a refused, unconfirmed or malformed one is null';

const OPERATOR = 'a lapsed sign-up’s identity that is an operator’s is purged from the shop but never erased';
const BOUND = 'eraseUnbound never erases an identity a shop’s login is bound to; an unbound one it erases';
const KEEP = 'a refused sign-up of an existing identity leaves it intact: a reserved web address (taken), and a second pending shop (MS020, waiting)';
const ENUM = 'an email with an account and a wrong password answers as a new email with a refused password, in one time band';
const ROLES = "Getting started is the office's: counter staff get none, a manager gets it without the owner's channel step";
const ON7 = "the sample shop's sign-up still opens a sandbox on the demo, beside the real one";
const HOSTED_CLOSED = "on a hosted database without Supabase's email, the real sign-up offers no form and a posted attempt makes no identity";
const DEMO_SIGNIN = "on the demo deployment /sign-in leads with the demo, and the owners' password form sits below it";
const EMAIL_LIMIT = "the link's post counts against the email before Supabase is asked: past the limit it never verifies";

const SIGNUPS = 'packages/core/src/jobs-signups.ts';
const CORE_ON = 'packages/core/src/onboarding.ts';
const PASSWORD = 'packages/adapters/identity/password.ts';
const ACTIONS = 'apps/web/app/(site)/sign-up/actions.ts';
const ON = 'onboarding.test.tsx';
const HOSTED = 'onboarding-hosted.test.tsx';

export const ONBOARDING_CASES: Case[] = [
  // The purge never asks the adapter to erase: the identity outlives its shop.
  db(ON4, 'v2-on4-no-erase', SIGNUPS, '      if (await erase(subject)) erased++;\n', ''),
  // With nothing wired, the purge commits anyway and orphans the identity.
  db(ON4_UNWIRED, 'v2-on4-unwired-purges', SIGNUPS, "if (!erase) throw new Error('jobs: lapsed sign-ups hold password identities and no identity eraser is wired');", 'if (!erase) return {};'),
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
  web(ON, ON2_EXPIRED, 'v2-on2-expired-listed', 'packages/core/src/onboarding.ts', 'as city,\n              ops.tenant_lapsed(t.tenant_id) as lapsed,', 'as city,\n              false as lapsed,'),
  // Only the network is counted, then only the email.
  web(ON, ON6, 'v2-on6-no-email-limit', ACTIONS, '  if (!(await emailWithin(auth, emailKey(input.email)))) redirect(back("limit"));\n', ''),
  web(ON, ON6, 'v2-on6-no-ip-limit', ACTIONS,
    '  if (emailVerifier()) notFound(); // with Supabase set, only the verified path makes a real shop\n  if (!(await networkWithin(auth, ctx.ipHash))) redirect(back("limit"));\n',
    '  if (emailVerifier()) notFound(); // with Supabase set, only the verified path makes a real shop\n'),
  // Home's Getting started is no role's (the role map's screen): the owner of an accepted shop does not see it.
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
  // An unverified email signs up on a hosted database: an identity and a shop are made.
  web(HOSTED, HOSTED_CLOSED, 'v2-on-hosted-unverified', CORE_ON, "  if (via === 'invite' && (await servedDeployment(pool))) return { kind: 'closed' };\n", ''),
  // The page offers the unverified form on a hosted database.
  web(HOSTED, HOSTED_CLOSED, 'v2-on-hosted-form', 'apps/web/app/(site)/sign-up/page.tsx', 'const soon = served && !emailLink;', 'const soon = false;'),
  // A new email's refused password skips scrypt: faster than a known email's wrong one.
  db(ENUM, 'v2-on-enum-timing', PASSWORD, 'const ok = (await matches(input.password, s)) && allowed && open(s, ctx);', 'const ok = allowed && (await matches(input.password, s)) && open(s, ctx);'),
  // The link returns to the request's own Origin.
  // Biome-ignore lint/suspicious/noTemplateCurlyInString: the source text the mutation matches, not a template
  web('onboarding-email.test.tsx', EMAIL1, 'v2-on-email-origin', ACTIONS, 'sendLink(email, `${appUrl}/sign-up/confirm`)', 'sendLink(email, `${(await headers()).get("origin") ?? appUrl}/sign-up/confirm`)'),
  // A finished sign-up's cookie stays.
  web('onboarding-email.test.tsx', EMAIL1, 'v2-on-email-cookie-kept', ACTIONS, '  clearPendingSignUp(jar);\n', ''),
  // The link's post is not counted against its email: Supabase is asked past the limit.
  web('onboarding-email.test.tsx', EMAIL_LIMIT, 'v2-on-email-finish-uncounted', ACTIONS, ' || !(await emailWithin(auth, pending.emailKey))', ''),
  // An operator's identity is erased.
  db(OPERATOR, 'v2-on4-operator-erased', PASSWORD, 's.memberships > 0 or s.is_operator)', 's.memberships > 0)'),
  // An identity a shop's login is bound to is erased.
  db(BOUND, 'v2-on-bound-erased', PASSWORD, '(s.memberships > 0 or s.is_operator)', '(s.is_operator)'),
  // A refused sign-up erases the identity it proved, made a moment ago or not.
  db(KEEP, 'v2-on-keep-erase-any', CORE_ON, 'if (made.created) await port.eraseUnbound(made.identity.subject);', 'await port.erase(made.identity.subject);'),
  // The MS020 path reads as a plain refusal.
  db(KEEP, 'v2-on-keep-ms020', CORE_ON, "    if (err.sqlstate === 'MS020') return { kind: 'waiting' };\n", ''),
  // Getting started is read for any role (the role map's gate gone): counter staff get it.
  web(ON, ROLES, 'v2-on-roles-staff', CORE_ON, "    if (!(await mayReadIn(c, 'screen.getting_started'))) return [];\n", ''),
  // A sample shop's Home shows Getting started.
  web(ON, ON7, 'v2-on7-sample-checklist', CORE_ON, '  if (!r?.real) return null;', '  if (!r) return null;'),
  // Any stock move, a sale too, ticks opening stock.
  web(ON, ROLES, 'v2-on-roles-sale-stock', CORE_ON, "where s.kind in ('opening', 'purchase', 'count_adjust')", 'where true'),
  // A manager is offered the owner's channel step.
  web(ON, ROLES, 'v2-on-roles-manager-channels', CORE_ON, 'channels: r.owner ? r.channels : null', 'channels: r.channels'),
  // The console's refusal of an acceptance reads as the authenticator's.
  web(ON, ON2_EXPIRED, 'v2-on2-refusal-line', 'apps/web/components/platform/failure.ts',
    '  tenant_accept: "Refused: this shop can no longer be accepted. It is accepted already, its sign-up expired, or it is not a real shop.",\n', ''),
  // 13: the demo's /sign-in leads with the password form.
  web(HOSTED, DEMO_SIGNIN, 'v2-on-demo-signin', 'apps/web/app/sign-in/page.tsx', 'if (kind === "demo") {', 'if (false) {'),
  // A digit in the English words.
  web(ON, WORDS, 'v2-on-words-digit', 'apps/web/lib/i18n-onboard.ts', 'last_day: "Less than a day left for approval.",', 'last_day: "Less than 1 day left for approval.",'),
  // seed:hosted's kirana ignores the owner's connection: the app's path, refused on a hosted database.
  web(HOSTED, ON5, 'v2-on5-app-path', 'db/seed/kirana.ts', 'const { session: owner, shopId } = opts.owner\n', 'const { session: owner, shopId } = false\n'),
  // A judge's sample shop is no sandbox: refused on a hosted database.
  web(HOSTED, ON7_HOSTED, 'v2-on7-not-sandbox', 'packages/core/src/logins.ts', "values ($1, $2, $3, 'synthetic', true)`", "values ($1, $2, $3, 'synthetic', false)`"),
];
