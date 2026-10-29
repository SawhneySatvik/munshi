// Red-proofs of core's reads, watchers and the agent's port on v2 (test/v2/core/{watchers,agent,hero}): each breaks one
// protection of packages/core/src/{queries*,watchers,approvals,commands-trade}.ts, the agent's flows or the schema, and
// its named test must fail. The v1 cases they succeed keep their mutation and their name, with a v2- prefix; the rest
// guard what v2 added (a finding re-seen by its row's cells, its severity, the 30-day rest).
import type { Case } from '../../sabotage.ts';
import { mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const c5 = 'test/v2/core/watchers/c5-watchers.test.ts';
const a1 = 'test/v2/core/agent/a1-agent.test.ts';
const h1 = 'test/v2/core/hero/h1-shelf-count.test.ts';
const h2 = 'test/v2/core/hero/h2-bill-read.test.ts';
const h3 = 'test/v2/core/hero/h3-voice.test.ts';
const QUERIES = 'packages/core/src/queries.ts';
const WATCHERS = 'packages/core/src/watchers.ts';
const APPROVALS = 'packages/core/src/approvals.ts';
const TRADE = 'packages/core/src/commands-trade.ts';
const PHOTO = 'packages/agent/src/photo.ts';
const BILL = 'packages/agent/src/bill.ts';
const SHELF = 'packages/agent/src/shelf.ts';
const VOICE = 'packages/agent/src/voice.ts';
const RUN_TS = 'packages/agent/src/run.ts';

const C5_FOUND = 'C5 the watchers find 5 of 5 planted kinds (8 of 8 situations) and nothing else';
const C5_TWICE = 'C5 re-running the watchers raises nothing twice, the same day or the next';
const C5_ACTOR = 'C5 watchers run with no actor and write no book row';
const C5_SEVERITY = "C5 a finding states its desk, its impact cell and that cell's severity, and pins the snapshot holding its row";
const C5_RESEEN =
  'C5 seen again, a finding names the new run, keeps its snapshot while its cells are the same, and moves to the new one (pinned, with a seen event) when they changed';
const A1_STALE = 'A1 a finding the latest watcher run still sees stays current; one it no longer sees is refused';
const A1_CLOSED = 'A1 a dismissed or resolved finding is neither explained nor drafted';
const A1_SECOND = 'A1 one draft per finding awaits a decision: draftFix proposes no second one';
const A1_NAMES = 'A1 an answer names a person only by citing their customer_id or supplier_id cell; every other id is refused';
const ANSWER = 'packages/agent/src/answer.ts';
const H1_FORGED = "H1 a forged count is refused: a response edited after it was hashed, or a count that is not the response's";
const H1_CELLS = 'H1 the count draft needs both cells: the count of that item from count.shelf, and its on-hand';
const H1_STILL = 'H1 only a still photo is sent: anything else is refused before any model is asked';
const H1_FORGE = 'H1 a catalogue name cannot forge a catalogue line: names reach the vision model quoted and escaped, one item a line';
const H1_QUARANTINE = 'H1 the vision call is quarantined: no tools are offered, and an answer with a tool call is refused whole';
const H1_PHRASES = 'H1 a phrase for a product outside the catalogue leaves the agent with no figure in it';
const H1_AGE = "H1 a count carries counted_at, and one older than the shop's count_max_age (6 hours by default) cannot back a draft, at proposal or at approval";
const H1_WRITERS =
  "H1 only the shelf flow stores a count: the port's recordCount is called only in shelf.ts with segment()'s response, and core's writer only through a pass-through binding";
const H2_UNMATCHED = 'H2 an unmatched bill line never becomes a book line';
const H2_UNPLACED = 'H2 a bill number with no page position is refused';
const H2_LATE = "H2 a bill's lines are accepted only in the transaction that read it";
const H2_MATCH = "H2 a line's text is matched by plain code: one item's exact name or alias, else none";
const H2_QUARANTINE = 'H2 the vision call is quarantined: no tools are offered, and an answer with a tool call is refused whole';
const H2_ONE_BILL = "H2 a bill draft is one bill as read: the bill's own supplier, number and date, each line's figures from one bill line, no bill line twice";
const H2_ONCE = 'H2 a bill read backs one executed purchase: a second draft of it goes stale at approval, and a third is refused at proposal';
const H3_TRACE = 'H3 the voice transcript never appears in a trace';

const EXPECTED_CHECK =
  "if (i.expectedQtyMilli !== undefined && i.expectedQtyMilli !== Number(expected)) throw new CoreError('conflict', { fields: ['expectedQtyMilli'] });";
const LOOK = 'const r = await generate({ ...req, role: "vision" }, o.deps);';
const TOOL_CALL = 'if (r.toolCalls.length > 0 || r.json === undefined) return "tool_call";';
// biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of watchers.ts, not a template
const DEDUPE_KEY = "const dedupeKey = `${w.kind}:${key.map((k) => keyText(row[k])).join(':')}`;";
const PLANTS = ['shrinkage', 'price_creep', 'expiry', 'overdue_credit', 'short_settlement'];

const ts = (sabotage: string, file: string, test: string, source: string, from: string, to: string): Case => ({
  sabotage,
  file,
  test,
  config: V2,
  ts: { file: source, from, to },
});
const sql = (sabotage: string, file: string, test: string, text: string): Case => ({ sabotage, file, test, config: V2, sql: text });
// Harness-level: the test asks sabotageIs(name) (a planted plant left out, a planted source file).
const harness = (sabotage: string, file: string, test: string): Case => ({ sabotage, file, test, config: V2 });

export const CORE_READS_CASES: Case[] = [
  // ---- C5: the watchers ----------------------------------------------------------------------------------------------
  ...PLANTS.map((p) => harness(`v2-c5-omit-${p}`, c5, C5_FOUND)),
  ts('v2-c5-shrinkage-threshold', c5, C5_FOUND, QUERIES, 'and (v.missing * v.unit_cost + 500) / 1000 >= 5000', 'and (v.missing * v.unit_cost + 500) / 1000 >= 0'),
  ts('v2-c5-creep-threshold', c5, C5_FOUND, QUERIES, 'and r.bills >= 2', 'and r.bills >= 5'),
  // A key that changes every run, or drifts by the day: the same-day re-run cannot see the second, the next morning's must.
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of watchers.ts, not a template
  ts('v2-c5-dedupe-per-run', c5, C5_TWICE, WATCHERS, DEDUPE_KEY, "const dedupeKey = `${w.kind}:${key.map((k) => keyText(row[k])).join(':')}:${runId}`;"),
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of watchers.ts, not a template
  ts('v2-c5-dedupe-drifts', c5, C5_TWICE, WATCHERS, DEDUPE_KEY, "const dedupeKey = `${w.kind}:${key.map((k) => keyText(row[k])).join(':')}:${day}`;"),
  // The watchers act as the owner: the database refuses a watch snapshot (and a raise) with an actor.
  ts(
    'v2-c5-watcher-actor',
    c5,
    C5_ACTOR,
    WATCHERS,
    "const { rows: t } = await c.query<{ time_zone: string }>('select time_zone from ops.tenant');",
    "await c.query(\"select set_config('munshi.actor_id', (select id::text from ops.member where role = 'owner' limit 1), true)\"); const { rows: t } = await c.query<{ time_zone: string }>('select time_zone from ops.tenant');",
  ),
  // The ladder's medium step moved by one paisa: Mohan L.'s ₹500 overdue is no longer medium.
  ts('v2-c5-severity-step', c5, C5_SEVERITY, WATCHERS, "n >= 50_000 ? 'medium'", "n >= 50_001 ? 'medium'"),
  // A re-see that never moves the finding: a row whose cells changed keeps showing yesterday's numbers.
  ts(
    'v2-c5-resee-no-move',
    c5,
    C5_RESEEN,
    WATCHERS,
    'set snapshot_id = $2, snapshot_row = $3, last_run_id = $4',
    'set snapshot_id = (case when $2::uuid is null then null else snapshot_id end), snapshot_row = (case when $3::int is null then null else snapshot_row end), last_run_id = $4',
  ),
  // A re-see that does not name the run: the finding reads as no longer seen.
  ts('v2-c5-resee-no-run', c5, C5_RESEEN, WATCHERS, 'last_run_id = $4 where', 'last_run_id = coalesce(last_run_id, $4::uuid) where'),
  ts('v2-c5-resee-no-run-a1', a1, A1_STALE, WATCHERS, 'last_run_id = $4 where', 'last_run_id = coalesce(last_run_id, $4::uuid) where'),
  // A dismissed key is raised again: the database refuses it (MS012), and with it the whole watcher run.
  ts(
    'v2-c5-dismissed-skip',
    a1,
    A1_CLOSED,
    WATCHERS,
    "\n            where not exists (select 1 from ai.finding f where f.dedupe_key = $3 and f.status = 'dismissed' and f.closed_at > now() - interval '30 days')",
    '',
  ),
  // ---- A1: the agent over its port -----------------------------------------------------------------------------------
  ts('v2-fc1-stale-finding', a1, A1_STALE, RUN_TS, '  if (!f.current) return abstain(run, null, ["finding_stale"]);\n', ''),
  // v1 broke the key-cell match; v2's current-ness is the latest watcher run naming the finding
  ts('v2-fc1-dedupe-not-current', a1, A1_STALE, WATCHERS, 'f.last_run_id is not distinct from (select r.id', 'f.last_run_id is distinct from (select r.id'),
  ts('v2-fc1-closed-finding', a1, A1_CLOSED, RUN_TS, '  if (f.status !== "open") return abstain(run, null, ["finding_closed"]);\n', ''),
  ts('v2-fc1-second-draft', a1, A1_SECOND, RUN_TS, '  if (f.openDraft) return { kind: "none", reason: "open_draft" };\n', ''),
  // Any id column passes as a person's name: an item's (or a bill's) id would be cited in an answer.
  ts('v2-a1-any-id-names', a1, A1_NAMES, ANSWER, 'export const personRef = (ref: CellRef) => PERSON_IDS.includes(ref.col);', 'export const personRef = (ref: CellRef) => ref.col.endsWith("_id");'),
  // ---- H1: the shelf count -------------------------------------------------------------------------------------------
  sql('v2-h1-count-unhashed', h1, H1_FORGED, 'alter table ops.shelf_count drop constraint shelf_count_hashed;'),
  sql('v2-h1-count-unmatched', h1, H1_FORGED, 'alter table ops.shelf_count drop constraint shelf_count_matches;'),
  ts('v2-h1-evidence-optional', h1, H1_CELLS, APPROVALS, 'const bad = rules.filter((r) => !numbers.some(([at]) => general(at) === r.at)).map((r) => r.at);', 'const bad: string[] = [];'),
  ts('v2-h1-evidence-any-read', h1, H1_CELLS, APPROVALS, 'rows[0]?.query_name !== rule.query || ', ''),
  ts('v2-h1-evidence-any-item', h1, H1_CELLS, APPROVALS, " || item?.kind !== 'text' || item.txt !== itemBeside(payload, at)", ''),
  ts('v2-h1-evidence-any-item-h2', h2, H2_UNMATCHED, APPROVALS, " || item?.kind !== 'text' || item.txt !== itemBeside(payload, at)", ''),
  // core-commands.ts carries the same mutation for C7
  ts('v2-h1-expected-unchecked', h1, H1_CELLS, TRADE, EXPECTED_CHECK, ''),
  ts('v2-h1-any-photo', h1, H1_STILL, PHOTO, '  return null;\n}', '  return "image/png";\n}'),
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of shelf.ts, not a template
  ts('v2-h1-shelf-raw-names', h1, H1_FORGE, SHELF, '${asData(JSON.stringify(txt(row.item) ?? ""))}', '${txt(row.item) ?? ""}'),
  ts('v2-h1-shelf-unescaped', h1, H1_FORGE, SHELF, 'asData(JSON.stringify(txt(row.item)', '(JSON.stringify(txt(row.item)'),
  ...[
    [h1, H1_QUARANTINE],
    [h2, H2_QUARANTINE],
  ].flatMap(([file, test], n) => [
    ts(
      `v2-vision-tools-offered${n ? '-h2' : ''}`,
      file as string,
      test as string,
      PHOTO,
      LOOK,
      'const r = await generate({ ...req, role: "vision", tools: [{ name: "items_list", description: "x", parameters: { type: "object", properties: {} } }] }, o.deps);',
    ),
    ts(`v2-vision-tool-call-used${n ? '-h2' : ''}`, file as string, test as string, PHOTO, TOOL_CALL, 'if (r.json === undefined) return "tool_call";'),
  ]),
  ts('v2-h1-phrase-digits', h1, H1_PHRASES, SHELF, 'p.phrase.replace(/\\p{N}/gu, "")', 'p.phrase'),
  ts('v2-h1-phrase-words', h1, H1_PHRASES, SHELF, 'if (phrase && textRules(phrase).length === 0) unrecognised.push(phrase);', 'if (phrase) unrecognised.push(phrase);'),
  ts('v2-h1-count-age-proposal', h1, H1_AGE, APPROVALS, 'return [...new Set([...bad, ...(await tooOld(c, command, refs))])];', 'return bad;'),
  ts(
    'v2-h1-count-age-approval',
    h1,
    H1_AGE,
    APPROVALS,
    '    for (const at of await tooOld(c, draft.command, draft.payload_refs)) changed.push(formatRef(draft.payload_refs[at] as CellRef));\n',
    '',
  ),
  sql('v2-h1-count-age-default', h1, H1_AGE, "alter table ops.tenant alter column count_max_age set default interval '1 day';"),
  ts('v2-h1-count-stamp-now', h1, H1_AGE, 'packages/core/src/queries-count.ts', 'sc.created_at as counted_at', 'now() as counted_at'),
  harness('v2-h1-count-writer-elsewhere', h1, H1_WRITERS),
  harness('v2-h1-count-binding-forged', h1, H1_WRITERS),
  harness('v2-h1-count-core-elsewhere', h1, H1_WRITERS),
  // ---- H2: the bill read ---------------------------------------------------------------------------------------------
  ts('v2-h2-unplaced-sent', h2, H2_UNPLACED, BILL, 'if (!l.qtyAt || !l.rateAt) return refuse("unplaced");', ''),
  sql('v2-h2-unplaced-stored', h2, H2_UNPLACED, 'alter table ops.bill_line drop constraint bill_line_placed;'),
  // v1's trigger was ops.bill_read_txn(); v2's evidence guard holds the same rule
  sql('v2-h2-late-line', h2, H2_LATE, mutate('ops.evidence_guard()', 'b.created_txid = txid_current()', 'true')),
  ts('v2-h2-ambiguous-match', h2, H2_MATCH, TRADE, 'return ids.length === 1 ? ids[0] : null;', 'return ids[0] ?? null;'),
  ts('v2-h2-bill-header-supplier', h2, H2_ONE_BILL, APPROVALS, "supplierId: 'supplier_id', ", ''),
  ts('v2-h2-bill-header-number', h2, H2_ONE_BILL, APPROVALS, "billNo: 'bill_no', ", ''),
  ts('v2-h2-bill-header-date', h2, H2_ONE_BILL, APPROVALS, " billDate: 'bill_date' ", ' '),
  ts('v2-h2-bill-line-split', h2, H2_ONE_BILL, APPROVALS, '    if ((lineOf.get(n) ?? source) !== source) bad.add(', '    if (false) bad.add('),
  ts('v2-h2-bill-line-twice', h2, H2_ONE_BILL, APPROVALS, ' || new Set(lineOf.values()).size < lineOf.size', ''),
  ts('v2-h2-bill-two-reads', h2, H2_ONE_BILL, APPROVALS, 'if (bills.size > 1 || ', 'if ('),
  ts(
    'v2-ms12-bill-twice-approval',
    h2,
    H2_ONCE,
    APPROVALS,
    "    if (draft.command === 'purchase.record' && (await billRecorded(c, draft.payload))) changed.push(...Object.values(draft.payload_refs).map(formatRef));\n",
    '',
  ),
  ts('v2-ms12-bill-twice-proposal', h2, H2_ONCE, APPROVALS, "    if (d.command === 'purchase.record' && (await billRecorded(c, payload))) throw new CoreError('conflict', { fields: ['billNo'] });\n", ''),
  // ---- H3: voice -----------------------------------------------------------------------------------------------------
  ts('v2-h3-transcript-traced', h3, H3_TRACE, VOICE, 'await trace("model", "voice");', 'await trace("model", transcript);'),
];
