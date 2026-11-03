// Red-proofs of the AI back office (BP-AI-1): the watchers keyed by capability, each new watcher's rule, the finding
// lifecycle, the brief and its ranking, the recipes, the taint rule, allow()'s caps and switches, and E1 over ai.*. Each
// breaks one protection of packages/core/src/{watchers,queries-watch-*,brief,allow}.ts, packages/agent/src/{run,port,
// recipes,desks}.ts or a function of 07_ai.sql, and its named test must fail.
import type { Case } from './case.ts';
import { mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const CORE = 'packages/core/src';
const AGENT = 'packages/agent/src';
const W = 'test/v2/core/watchers';

const orders = `${W}/w-orders.test.ts`;
const stock = `${W}/w-stock-staff.test.ts`;
const salon = `${W}/w-salon.test.ts`;
const holds = `${W}/w-holds.test.ts`;
const life = `${W}/w-lifecycle.test.ts`;
const registry = `${W}/w-registry.test.ts`;
const brief = 'test/v2/core/brief/brief.test.ts';
const allow = 'test/v2/core/allow/allow.test.ts';
const recipes = 'test/v2/core/recipes/recipes.test.ts';

const ORD = 'W-ORD the order watchers find the planted request, late order and unapplied advance, and nothing else; none while orders is off';
const STK_OFF = 'W-STK with stock and staff off, a run reads neither watcher and the shop gets none of their findings';
const STK = 'W-STK dead stock: the jar never sold since day −45 and the soap last sold on day −45, nothing else';
const STF = 'W-STF an advance still out after 30 days: ₹800 owed by one staff member since day −40, nothing else';
const BKG_OFF = 'W-BKG with bookings, packages and campaigns off, a run reads none of their watchers and the salon gets none of their findings';
const IDLE = 'W-BKG idle_stylist: Bilal, 1,320 of 1,440 rostered minutes unbooked over three days at ₹600 a service, nothing else';
const ABSENT = 'W-BKG stylist_absent_booked: Asha marked absent on day 1 with a haircut, Chitra on leave on day 2 with a facial, nothing else';
const UNBILLED = "W-BKG unbilled_booking: day −1's haircut, still confirmed with no sale; the billed and the no-show are not";
const PRESSURE = "W-BKG hold_pressure: three of the public's holds on Bilal's day 1 lapsed in the hour (₹1,500); Asha's two are under the threshold";
const PKG = 'W-PKG package_expiry: the pack lapsing on day 10 and the one lapsed on day −3, each with 5 facials (₹2,000) left; not the one lapsing on day 20';
const CUS = 'W-CUS regulars_lapsing: Rekha, 3 visits, the last on day −76, ₹1,500 over 60 days (₹750 a month); not Sunil (day −59) nor Tara (2 visits and her packs)';
const HLD_OFF = 'W-HLD with holds off, a run reads no hold and the shop gets no hold finding';
const HLD = 'W-HLD hold_expiring: the saree whose hold ends within 24 hours, at ₹4,500; not the kurta held 48 hours, nor the dupatta only asked for';
const REG = 'W-REG the seventeen watchers of §7.3, each keyed by its capability, on a desk that owns it, over a registered read with a money impact';
const REG_DESKS = 'W-REG every capability of ref.capability is some desk’s part, or one of the four that open none; the registry names no other';
const LIFE_SEEN = 'LIFE raised once; re-seen with the same cells it keeps its snapshot and writes no event; with changed cells it moves and writes seen';
const LIFE_RESOLVE = 'LIFE cleared, the next run of its kind resolves it with no actor; recurring, it is raised again as a new finding';
const LIFE_REST = 'LIFE dismissed, its key rests 30 days: not raised at 29, raised again at 31';
const LIFE_WAKE = 'LIFE snoozed, it is still seen and stays snoozed; the run after its snooze ends wakes it';
const BRIEF_RANK = 'BRIEF the ranking is the pinned brief.ranked snapshot’s rank cells, |impact| × (1 + 0.05 × days open), and ai.brief keeps no list of its own';
const BRIEF_LINES = 'BRIEF with AI on and under its cap, each high finding’s line is validated model text, in rank order; the rest are templates';
const BRIEF_FREE = 'BRIEF a line with a free number is refused, by the validator or by core’s own check, and the brief falls back to its templates';
const BRIEF_CAP = 'BRIEF over the cap (or with AI off), no model is asked and every line is its template';
const E1 = 'E1-AI an answer’s words live only in erasable ops.message_text: ai.* keeps refs and verdicts, and once erased the words are gone';
const ALLOW_TEXT = 'ALLOW1 the text roles share the shop’s daily text cap: three calls pass, the fourth is refused and not counted';
const ALLOW_MEDIA = 'ALLOW2 the media roles have their own cap, and spending it leaves the text cap untouched';
const ALLOW_OFF = 'ALLOW3 off is off: the shop’s config switched off, or the deployment’s switch, refuses every role and counts nothing';
const ALLOW_RACE = 'ALLOW4 two calls racing for the last text call: the second waits on the first and is refused when it commits';
const ALLOW_RUN = 'ALLOW5 refused, an agent run abstains with no model call and no error, and says why in its trace';
const RCP_REORDER = 'RCP shrinkage → reorder.place: the 48 packs of the latest bill line, from its supplier, every number a cell core resolved';
const RCP_REMIND = "RCP overdue credit → customer.remind (credit_due): no number in the payload; its figure is the customer's current balance cell, ₹300";
const TAINT = 'TAINT a run tapped for purchase.record that reads bill text is tainted; its port then refuses every other proposal before core, and the database refuses one that gets past';

const ts = (sabotage: string, file: string, test: string, source: string, from: string, to: string): Case => ({
  sabotage,
  file,
  test,
  config: V2,
  ts: { file: source, from, to },
});
const sql = (sabotage: string, file: string, test: string, text: string): Case => ({ sabotage, file, test, config: V2, sql: text });

const WATCHERS_TS = `${CORE}/watchers.ts`;
const ORDERS_Q = `${CORE}/queries-watch-orders.ts`;
const STOCK_Q = `${CORE}/queries-watch-stock.ts`;
const PEOPLE_Q = `${CORE}/queries-watch-people.ts`;
const BOOKING_Q = `${CORE}/queries-watch-bookings.ts`;
const BRIEF_Q = `${CORE}/queries-watch-brief.ts`;
const BRIEF_TS = `${CORE}/brief.ts`;
const ALLOW_TS = `${CORE}/allow.ts`;
const RUN_TS = `${AGENT}/run.ts`;
const PORT_TS = `${AGENT}/port.ts`;
const RECIPES_TS = `${AGENT}/recipes.ts`;
const DESKS_TS = `${AGENT}/desks.ts`;

const CAPABILITY_GATE = '      if (!on.has(w.needs)) continue;\n';

export const CORE_AI_CASES: Case[] = [
  // ---- keyed by capability ----------------------------------------------------------------------------------------
  // Every watcher runs whatever the shop has switched off.
  ...[
    [orders, ORD],
    [stock, STK_OFF],
    [salon, BKG_OFF],
    [holds, HLD_OFF],
  ].map(([file, test], n) => ts(`v2-ai-capability-ignored${n ? `-${n + 1}` : ''}`, file as string, test as string, WATCHERS_TS, CAPABILITY_GATE, '')),
  // The capabilities read ignores the switches: every capability reads as on, so a shop with stock off gets its findings.
  ts(
    'v2-ai-switch-ignored',
    stock,
    STK_OFF,
    WATCHERS_TS,
    'coalesce((select s.is_on from ops.capability_switch s where s.capability = r.code order by s.at desc, s.id desc limit 1), false)',
    'true',
  ),
  // hold_expiring keyed by stock instead of holds.
  ts('v2-ai-registry-capability', registry, REG, WATCHERS_TS, "needs: 'holds', desk: 'stock'", "needs: 'stock', desk: 'stock'"),
  ts('v2-ai-desk-part-dropped', registry, REG_DESKS, DESKS_TS, '      ["gst", "gst"],\n', ''),
  // ---- each new watcher's rule --------------------------------------------------------------------------------------
  ts('v2-ai-unanswered-window', orders, ORD, ORDERS_Q, "r.created_at <= $1::timestamptz - interval '30 minutes'", "r.created_at <= $1::timestamptz - interval '28 minutes'"),
  ts('v2-ai-late-ready', orders, ORD, ORDERS_Q, "st.step not in ('ready', 'cancelled', 'delivered')", "st.step not in ('cancelled', 'delivered')"),
  ts('v2-ai-advance-open-order', orders, ORD, ORDERS_Q, " and st.step in ('cancelled', 'delivered')", ''),
  ts('v2-ai-dead-window', stock, STK, STOCK_Q, "(select end_at from bounds) - interval '45 days'", "(select end_at from bounds) - interval '44 days'"),
  ts('v2-ai-advance-window', stock, STF, PEOPLE_Q, 'and p.oldest < $1::date - 30', 'and p.oldest <= $1::date - 30'),
  ts('v2-ai-hold-window', holds, HLD, STOCK_Q, "r.held_until <= $1::timestamptz + interval '24 hours'", "r.held_until <= $1::timestamptz + interval '49 hours'"),
  ts('v2-ai-lapsing-window', salon, CUS, PEOPLE_Q, 'v.n >= 3 and v.last_on <= $1::date - 60', 'v.n >= 3 and v.last_on <= $1::date - 59'),
  ts('v2-ai-package-window', salon, PKG, PEOPLE_Q, 'h.expires_on <= $1::date + 14', 'h.expires_on <= $1::date + 20'),
  ts('v2-ai-idle-share', salon, IDLE, BOOKING_Q, '* 100 >= p.rostered * 40', '* 100 >= p.rostered * 25'),
  ts('v2-ai-absent-mark', salon, ABSENT, BOOKING_Q, "in ('absent', 'leave')", "in ('leave')"),
  ts('v2-ai-unbilled-sale', salon, UNBILLED, BOOKING_Q, 'and sa.booking_id = b.id and', 'and sa.booking_id = b.id and false and'),
  ts('v2-ai-pressure-count', salon, PRESSURE, BOOKING_Q, 'having count(*) >= 3', 'having count(*) >= 2'),
  // ---- the lifecycle ------------------------------------------------------------------------------------------------
  // A re-see with the same cells moves the finding anyway (and writes a seen event).
  sql(
    'v2-ai-resee-same-cells-moves',
    life,
    LIFE_SEEN,
    mutate('ai.finding_flow()', 'if new.row_sha256 = old.row_sha256 then', 'if false then'),
  ),
  ts(
    'v2-ai-no-resolve',
    life,
    LIFE_RESOLVE,
    WATCHERS_TS,
    "where kind = $1 and status in ('open', 'snoozed') and dedupe_key <> all ($2::text[])",
    "where false and kind = $1 and status in ('open', 'snoozed') and dedupe_key <> all ($2::text[])",
  ),
  // A resolved key is held back like a dismissed one: the situation recurs and nothing is raised.
  ts("v2-ai-no-reraise", life, LIFE_RESOLVE, WATCHERS_TS, "f.dedupe_key = $3 and f.status = 'dismissed'", "f.dedupe_key = $3 and f.status in ('dismissed', 'resolved')"),
  ts(
    'v2-ai-rest-too-long',
    life,
    LIFE_REST,
    WATCHERS_TS,
    "f.status = 'dismissed' and f.closed_at > now() - interval '30 days'",
    "f.status = 'dismissed' and f.closed_at > now() - interval '40 days'",
  ),
  ts('v2-ai-no-wake', life, LIFE_WAKE, WATCHERS_TS, "update ai.finding set status = 'open' where status = 'snoozed' and snoozed_until <= now()", 'select 1'),
  // ---- the brief ----------------------------------------------------------------------------------------------------
  ts('v2-ai-rank-no-age', brief, BRIEF_RANK, BRIEF_Q, 'o.impact * (20 + least(o.days_open, 14)) as score', 'o.impact * 20 as score'),
  // A line paired with a finding by its position among the segments: the brief keeps a second order of its own.
  ts(
    'v2-ai-brief-by-position',
    brief,
    BRIEF_LINES,
    BRIEF_TS,
    'const segment = at ? (brief.refs ?? []).findIndex((refs) => refs.length > 0 && refs.every((r) => sameCell(r, at))) : -1;',
    'const segment = at ? i : -1;',
  ),
  ts('v2-ai-brief-unchecked', brief, BRIEF_FREE, BRIEF_TS, '    if (answerRules(s.text).length) return false;\n', ''),
  ts('v2-ai-allow-skipped', brief, BRIEF_CAP, RUN_TS, 'if (run.o.port.allow && !(await run.o.port.allow(req.role))) {', 'if (false) {'),
  ts('v2-ai-allow-skipped-run', allow, ALLOW_RUN, RUN_TS, 'if (run.o.port.allow && !(await run.o.port.allow(req.role))) {', 'if (false) {'),
  // The scan reaches every ai.* table: a table that kept an answer's words would be found.
  sql(
    'v2-ai-e1-words-kept',
    brief,
    E1,
    `create table ai.kept_words (body text);
     grant insert on ai.kept_words to munshi_jobs, munshi_app;
     create function ai.keep_words() returns trigger language plpgsql as $$ begin insert into ai.kept_words values (new.body); return null; end $$;
     create trigger keep after insert on ops.message_text for each row execute function ai.keep_words();`,
  ),
  // ---- allow() ------------------------------------------------------------------------------------------------------
  ts('v2-ai-allow-per-role', allow, ALLOW_TEXT, ALLOW_TS, 'u.role = any ($4::text[])) < $5', 'u.role = $3 and $4::text[] is not null) < $5'),
  ts('v2-ai-allow-media-text-cap', allow, ALLOW_MEDIA, ALLOW_TS, 'const cap = media ? limits.mediaDailyCalls : limits.aiDailyCalls;', 'const cap = limits.aiDailyCalls;'),
  ts('v2-ai-allow-kill-switch', allow, ALLOW_OFF, ALLOW_TS, "  if (deploymentAi !== 'on') return { ok: false, reason: 'off' };\n  const limits = await platformLimits(c, tenantId);\n  if (!limits.aiEnabled)", '  const limits = await platformLimits(c, tenantId);\n  if (!limits.aiEnabled)'),
  ts('v2-ai-allow-platform-off', allow, ALLOW_OFF, ALLOW_TS, "  if (!limits.aiEnabled) return { ok: false, reason: 'off' };\n", ''),
  ts('v2-ai-open-at-cap', allow, ALLOW_TEXT, ALLOW_TS, 'return { text: used.text < limits.aiDailyCalls,', 'return { text: used.text <= limits.aiDailyCalls,'),
  ts('v2-ai-allow-no-lock', allow, ALLOW_RACE, ALLOW_TS, "  await c.query('select pg_advisory_xact_lock(hashtextextended($1, 0))',", "  await c.query('select $1::text',"),
  // ---- recipes and the taint rule -----------------------------------------------------------------------------------
  ts('v2-ai-recipe-unmapped', recipes, RCP_REORDER, RECIPES_TS, 'payloadRefs: { "lines[0].qtyMilli": ref(last.snapshotId, 0, "qty") },', 'payloadRefs: {},'),
  ts('v2-ai-recipe-stale-figure', recipes, RCP_REMIND, RECIPES_TS, 'const figure = ref(balance.snapshotId, 0, "balance");', 'const figure = ref(f.snapshotId, f.row, "overdue");'),
  ts('v2-ai-taint-unguarded', recipes, TAINT, PORT_TS, '      if (tainted && draft.command !== recipe) throw new TaintRefused();\n', ''),
  ts('v2-ai-taint-unmarked', recipes, TAINT, PORT_TS, '    await port.taint?.();\n', ''),
];
