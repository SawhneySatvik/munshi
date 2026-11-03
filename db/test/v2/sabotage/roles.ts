// Red-proofs of one rule for what each role may read (test/v2/core/agent/role-reads.test.ts for R1, R3, R4, R6, R7;
// apps/web/test/roles.test.tsx for R2 and R5; AGENTS2 for Home's own drafts): each breaks one layer of the rule, as a
// source-text mutation applied as vitest loads the module.
import type { Case } from './case.ts';

const V2 = 'vitest.v2.config.ts';
const CORE_TEST = 'test/v2/core/agent/role-reads.test.ts';
const WEB = { dir: 'apps/web', config: 'vitest.config.ts', file: 'test/roles.test.tsx' } as const;

const R1 = 'counter staff are refused the salary, settlement and report reads in core; the office makes them; nothing is minted';
const R2 = "a counter staff member's Why? on a short settlement abstains and mints nothing; its fix drafts nothing";
const R3 = "every named read has a role entry, and Ask's desks offer each role only reads it may make";
const R4 = 'a staff question routed to a desk outside their role abstains and reads nothing; their stock desk offers no bill read';
const R5 = "counter staff get 404 on reports, bills, suppliers and the office's other pages; the owner gets each page; staff keep their own";
const R6 = "a switched-off capability's read is refused for every role, the owner too";
const R7 = 'a stored snapshot reaches a member only if their role may read it, each row cut to their columns; staff get no "Record this payment"';
const R2_ACTIONS = "the office's actions refuse counter staff before any run: a bill photo replayed, the inbox's and campaigns' agents";
const R2_ASK = 'a counter staff member asks the credit book and is answered (recorded); Ask offers them only that question; they read their own answer aloud';
const FIX = "Draft the fix leaves each finding's recipe as a draft waiting in Home's tray, pending; nothing reaches the books before approval";

const ROLES_TS = 'packages/core/src/read-roles.ts';
const RUN_TS = 'packages/agent/src/run.ts';

const core = (sabotage: string, test: string, file: string, from: string, to: string): Case => ({ sabotage, file: CORE_TEST, test, config: V2, ts: { file, from, to } });
const web = (sabotage: string, test: string, file: string, from: string, to: string): Case => ({ sabotage, test, ...WEB, ts: { file, from, to } });

export const ROLES_CASES: Case[] = [
  // ---- the map, enforced where every snapshot is minted
  // mintIn skips the gate: every member reads everything.
  core('roles-mint-ungated', R1, 'packages/core/src/snapshots.ts', '  await refuseRead(c, name, p);\n', ''),
  // The gate ignores the role: staff read the office's figures.
  core('roles-role-ignored', R1, ROLES_TS, 'if (!rule.roles.includes(asker.role) && !window)', 'if (false)'),
  // The counter's window opens any day's report to staff.
  core('roles-window-any-day', R1, ROLES_TS, "counter: (p, today) => p.from === today && p.to === today", 'counter: () => true'),
  // The gate ignores the capability: a switched-off capability's reads go on.
  core('roles-capability-ignored', R6, ROLES_TS, "  if (rule.cap !== null && !asker.on.has(rule.cap)) throw new CoreError('capability_off', { fields: [rule.cap] });\n", ''),
  // A registered read with no entry in the map.
  core('roles-map-not-total', R3, ROLES_TS, "  'paypal.event': office(),\n", ''),
  // ---- Ask
  // Every desk offers every tool, whatever the asker may read.
  core('roles-tools-unfiltered', R3, 'packages/agent/src/tools.ts', 'DESK_TOOLS[desk].filter((t) => !scope || scope.reads.has(t.query))', 'DESK_TOOLS[desk]'),
  // Counter staff may route to the Sales desk: its tools are reads of the office's.
  core('roles-sales-desk-staff', R3, ROLES_TS, "  sales: { roles: OFFICE, cap: 'counter' },", "  sales: { roles: ALL, cap: 'counter' },"),
  // A route to a desk outside the asker's scope is followed.
  core('roles-route-unguarded', R4, RUN_TS, '    if (!open.includes(desk)) return abstain(run, null, ["not_for_role"]);\n', ''),
  // The router is shown every desk, whatever the asker may ask.
  core('roles-router-every-desk', R4, RUN_TS, '        { role: "system", content: router(open) },', '        { role: "system", content: router(DESKS) },'),
  // ---- a finding's row, and the screens
  // The app's port reads any finding for the member: staff explain a short settlement from its row.
  web('roles-port-finding-any', R2, 'apps/web/lib/server/agent-port.ts', 'const state = await findingFor(app, session, findingId);', 'const state = await findingState(app, tenantId, findingId);'),
  // Core's findingFor checks no role.
  web('roles-finding-for-any', R2, 'packages/core/src/watchers.ts', 'return state && watcher && asker?.whole.has(watcher.query) ? state : null;', 'return state;'),
  // findingFor asks only that the read is theirs, not that they see its whole row: staff's Why? on a shelf gap hands a
  // model its unit cost and loss.
  web('roles-finding-not-whole', R2, 'packages/core/src/watchers.ts', 'asker?.whole.has(watcher.query)', 'asker?.reads.has(watcher.query)'),
  // Home's moves ignore whether the row is seen whole: staff are offered Why? on a stock finding.
  web('roles-home-moves-unwhole', R2, 'apps/web/lib/server/home.ts', 'why: EXPLAINED_KINDS.includes(kind) && whole(kind)', 'why: EXPLAINED_KINDS.includes(kind)'),
  // A stored snapshot keeps the office's columns for staff: unit cost and loss reach their screen and device.
  web('roles-stored-uncut', R2, 'packages/core/src/views-common.ts', 'rows: asker ? rowsFor(asker.role, s.query_name, rows) : rows }', 'rows }'),
  // The brief is read for any role.
  web('roles-brief-any-role', R2, 'packages/core/src/views-office.ts', "  if (!(await mayReadIn(c, 'brief.ranked'))) return { viewer: me, briefs: [], snapshots: [] };\n", ''),
  // ---- the office's actions, callable while their pages answer 404
  web('roles-bill-photo-open', R2_ACTIONS, 'apps/web/app/app/bills/photo-actions.ts', '    if (!(await memberMayRead(await appPool(), session, "bill.lines"))) return { error: "refused" };\n', ''),
  web('roles-inbox-tap-open', R2_ACTIONS, 'apps/web/app/app/inbox/actions.ts', '    if (!(await memberMayRead(await appPool(), session, "inbox.extract"))) return { note: refused, ok: false };\n', ''),
  web(
    'roles-campaign-copy-open',
    R2_ACTIONS,
    'apps/web/app/app/campaigns/actions.ts',
    '    if (!(await memberMayRead(await appPool(), session, "campaign.audience"))) return { note: "errStaff", ok: false };\n',
    '',
  ),
  // ---- Ask's screen
  // Staff are offered the sales question too.
  web('roles-ask-every-question', R2_ASK, 'apps/web/app/app/ask/page.tsx', 'RECORDED_QUESTIONS.filter((q) => floor.desks.includes(RECORDED_DESK[q] ?? ""))', 'RECORDED_QUESTIONS'),
  // ---- stored snapshots, fail closed, PayPal
  core('roles-stored-unfiltered', R7, 'packages/core/src/views-common.ts', 'if (!s || (asker && !asker.reads.has(s.query_name))) return [];', 'if (!s) return [];'),
  core('roles-paypal-record-staff', R7, 'packages/core/src/payments-paypal.ts', "may.has('payment.record') && (await mayReadIn(c, 'paypal.event'))", "may.has('payment.record')"),
  // A transaction withTx did not open passes ungated, whoever its context names.
  core('roles-raw-tx-ungated', R1, ROLES_TS, "coalesce($1::uuid, nullif(current_setting('munshi.actor_id', true), '')::uuid)", '$1::uuid'),
  // Home shows every finding to every role.
  web('roles-home-every-finding', R2, 'packages/core/src/views-home.ts', '[WATCHERS.filter((w) => reads.has(w.query)).map((w) => w.kind)]', '[WATCHERS.map((w) => w.kind)]'),
  // The overdue card's Why? reads the office's total for staff.
  web('roles-card-unguarded', R2, RUN_TS, '  if (run.scope && (!run.scope.reads.has(card.query) || !deskOpen(run, card.desk))) return abstain(run, null, ["not_for_role"]);\n', ''),
  // Home's tray shows counter staff every draft, not just their own.
  { sabotage: 'roles-home-every-draft', file: 'test/agents-wired.test.tsx', test: FIX, dir: 'apps/web', config: 'vitest.config.ts', ts: { file: 'packages/core/src/views-home.ts', from: "const everyone = (OFFICE_ROLES as readonly string[]).includes(me.member.role);", to: 'const everyone = true;' } },
  // The report's view opens for any role.
  web('roles-report-open', R5, 'packages/core/src/views-report.ts', "  if (!(await mayReadIn(c, 'sales.by_day'))) return null;\n", ''),
  // The suppliers page opens for any role.
  web('roles-suppliers-open', R5, 'packages/core/src/views-bills.ts', "  if (!(await mayReadIn(c, 'purchases.last_prices'))) return null;\n", ''),
  // The requests page (no named read stands for it) opens for any role.
  web('roles-requests-open', R5, 'packages/core/src/views-people.ts', "  if (!(await mayReadIn(c, 'screen.requests'))) return null; // the office's (read-roles.ts SCREENS)\n", ''),
  // The orders, customers, calendar and office pages open for any role.
  web('roles-orders-open', R5, 'packages/core/src/views-orders.ts', " || !(await mayReadIn(c, 'order.board'))", ''),
  web('roles-customers-open', R5, 'packages/core/src/read-roles.ts', "  'screen.customers': office(),", "  'screen.customers': all(),"),
  web('roles-calendar-open', R5, 'packages/core/src/views-people.ts', " || !(await mayReadIn(c, 'screen.calendar'))", ''),
  web('roles-office-open', R5, 'apps/web/lib/server/desks.ts', '    if (!(await mayReadIn(c, "desks.week"))) return { brief, desks: null, states: {} };\n', ''),
  web('roles-invoice-open', R5, 'packages/core/src/views-sell.ts', " || !(await mayReadIn(c, 'invoice.detail'))", ''),
];
