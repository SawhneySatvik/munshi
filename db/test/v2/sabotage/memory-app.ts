// Red-proofs of W2-A's app side, memory and "why this number" (test/v2/core/memory/mem.test.ts, the web's
// test/memory.test.tsx, test/memory-recorded.test.tsx and ON5 in test/onboarding-hosted.test.tsx): each breaks one layer
// of core, the agent, the app or the seed as a source-text mutation applied as vitest loads the module. The schema's own
// memory gates are red-proved in memory.ts.
import type { Case } from './case.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/core/memory/mem.test.ts';

const MEM1 = 'MEM-APP1 a rejection with words makes a declined note citing its decision, written by the approver in that transaction; an approval with words a preference';
const MEM2 =
  'MEM-APP2 words with a digit (Latin or Devanagari), a number word or a handle, in another script or too long, are refused by reason before any transaction, and nothing is written';
const MEM3 = 'MEM-APP3 an ended or expired note is not in force and not in the prompt; the note in force opens it; staff are given none';
const MEM4 = 'MEM-APP4 on a live shop a customer named in the words is kept as their role, and the note is about them';
const MEM5 = "MEM-APP5 erasing a person's contact blanks the words of every note about them and ends them in force; other notes stay";
const MEM6 = "MEM-APP6 Forget is the owner's alone: a manager and counter staff are refused before any write; the owner's ends the note, audited";
const MEM7 =
  "MEM-APP7 a live shop's note masks a whole name or a first name, with a name's suffixes, any case, and keeps ordinary words; an erasure's net catches what masking leaves";
const GRAPH1 = 'GRAPH1 the walk from a seeded figure reaches its snapshot, the book row it was read from, the decision that wrote it and who approved it';
const GRAPH2 =
  "GRAPH2 counter staff's walk stops at the book row: no decision, no approver, nothing under it, on the screen or replayed; nor a walk from a figure they may not see";
const GRAPH3 = "GRAPH3 a total ends at its read, whole; a read of the shop's other records ends there too; only a cell or a snapshot that is not there breaks";
const GRAPH4 = 'GRAPH4 every named read is a source-row read, a total or unwalkable, exactly once';
const GRAPH5 = 'GRAPH5 the walk goes two decisions deep through what each cited, and no further';

const KEEPER1 = "the office lists each note in force with its words and source chip; Forget is the owner's alone";
const KEEPER2 =
  "a decision card sends the person's words with the verdict; words with a number are refused with the card's message and nothing is written";
const WHY1 =
  "the drawer walks a figure on request: a total ends whole at its read; Cannot verify only where the chain breaks; another role's figure is refused";
const MEMREC1 = "with the seed's notes in force, a recorded owner Ask still matches its fixture and answers";
const MEMREC2 = "the app's port gives a run the notes only when the models answer live: none in record or recorded mode";
const ON5 = "seed:hosted's kirana seeds Sharma on a hosted demo database through the owner role, and /demo/sharma-general-store opens its people";

const APPROVALS = 'packages/core/src/approvals.ts';
const MEMORY = 'packages/core/src/memory.ts';
const QUERIES = 'packages/core/src/queries-memory.ts';
const ROLES = 'packages/core/src/read-roles.ts';
const PORT = 'apps/web/lib/server/agent-port.ts';

const ts = (sabotage: string, test: string, file: string, from: string, to: string): Case => ({ sabotage, file: FILE, test, config: V2, ts: { file, from, to } });
const webIn =
  (testFile: string) =>
  (sabotage: string, test: string, file: string, from: string, to: string): Case => ({
    sabotage,
    test,
    dir: 'apps/web',
    config: 'vitest.config.ts',
    file: testFile,
    ts: { file, from, to },
  });
const web = webIn('test/memory.test.tsx');
const recorded = webIn('test/memory-recorded.test.tsx');
const hosted = webIn('test/onboarding-hosted.test.tsx');

export const MEMORY_APP_CASES: Case[] = [
  // ---- notes
  // A rejection's words are dropped: no note is written.
  ts('mem-app-declined-dropped', MEM1, APPROVALS, "      await remember('declined');\n", ''),
  // Core skips the number grammar: a number word is kept, a digit reaches the database.
  ts('mem-app-no-grammar', MEM2, MEMORY, "  if (rules.length > 0) throw refuse('note.number');\n", ''),
  // A handle passes: ⟦a⟧ is kept, ⟦1⟧ reaches the database.
  ts('mem-app-handle-allowed', MEM2, MEMORY, "  if (/[⟦⟧]/u.test(w)) throw refuse('note.number');\n", ''),
  // The notes given to a run are every note ever written, ended and expired ones too.
  ts(
    'mem-app-ended-in-force',
    MEM3,
    MEMORY,
    'from ai.memory_in_force() n order by',
    'from (select m.id, m.kind, t.body as text, m.valid_from from ai.memory m join ops.message_text t on t.tenant_id = m.tenant_id and t.id = m.text_id) n order by',
  ),
  // Counter staff are given the office's notes.
  ts('mem-app-staff-notes', MEM3, MEMORY, "    if (!(await mayReadIn(c, 'memory.in_force'))) return [];\n", ''),
  // The run never puts its notes in the prompt.
  ts('mem-app-prompt-bare', MEM3, 'packages/agent/src/run.ts', '  if (!run.notes || at < 0) return req;', '  return req;'),
  // A live shop's note keeps the customer's name.
  ts('mem-app-live-unmasked', MEM4, MEMORY, '    if (live) kept = kept.replace(', '    if (false) kept = kept.replace('),
  // A person's erasure leaves the words of the notes about them.
  ts('mem-app-erasure-keeps-notes', MEM5, MEMORY, '    return { notes: await eraseNotesOfErased(c, rows[0].name ? [rows[0].name] : []) };', '    return { notes: 1 };'),
  // The erasure's net is off: a note naming them with an empty `about` keeps its words.
  ts('mem-app-erasure-names-unread', MEM5, MEMORY, 'eraseNotesOfErased(c, rows[0].name ? [rows[0].name] : [])', 'eraseNotesOfErased(c)'),
  // Forget asks only for the office, not the owner: a manager reaches the database.
  ts('mem-app-forget-office', MEM6, MEMORY, '    await refuseNoteWriter(c, session, true);', '    await refuseNoteWriter(c, session);'),
  // An ordinary word that is a one-word name is masked: "sunny days" loses its meaning.
  ts('mem-app-ordinary-masked', MEM7, MEMORY, '    const plainWhole = nameParts(whole).length === 1 && ORDINARY.has(whole.toLowerCase());', '    const plainWhole = false;'),
  // A name's suffixes are not read: "Guptaji" keeps the name.
  ts('mem-app-suffix-blind', MEM7, MEMORY, "const SUFFIX = `(?:'s|’s|-?ji|-?bhai|-?ben|\\\\s?जी|\\\\s?भाई|\\\\s?बेन)?`;", "const SUFFIX = '';"),
  // The erasure's net reads only the name's own script: a Devanagari spelling of a Latin name survives.
  ts('mem-app-cross-script-net', MEM7, MEMORY, '  return (deva.test(text) && !deva.test(name)) || (latin.test(text) && !latin.test(name));', '  return false;'),
  // ---- the walk
  // The shrinkage watcher's figure names no source row: the walk stops at its snapshot.
  ts('graph-shrinkage-unmapped', GRAPH1, QUERIES, "  'watch.shrinkage': 'move_id',\n", ''),
  // No node is cut for a role: staff see the decision, its approver and what it cited.
  ts('graph-nodes-uncut', GRAPH2, ROLES, "  if (name === 'why.chain') {", '  if (false) {'),
  // Staff's walk goes past the book row to the decision and its approver.
  ts('graph-staff-sees-approver', GRAPH2, ROLES, '    if (!(OFFICE_ROLES as readonly string[]).includes(role)) {', '    if (false) {'),
  // The walk starts from any figure: staff walk the office's loss.
  ts('graph-root-unchecked', GRAPH2, 'packages/core/src/views-memory.ts', '  if (asker && s && (!asker.reads.has(s.query_name) ||', '  if (false && asker && s && (!asker.reads.has(s.query_name) ||'),
  // A cell that is not there ends quietly, as if the chain were whole.
  ts('graph-break-silent', GRAPH3, QUERIES, '               where not exists (select 1 from root r where r.has_cell)', '               where false'),
  // A total is drawn as a broken chain: "Cannot verify" on every figure the books add up.
  ts('graph-total-as-break', GRAPH3, QUERIES, "when r.query_name in (select q from agg) then 'total'", "when false then 'total'"),
  // A new read in none of the three maps: its figures would walk to a break.
  ts('graph-read-unplaced', GRAPH4, QUERIES, "'items.price', 'items.list', 'stock.on_hand', 'stock.available',", "'items.price', 'items.list', 'stock.available',"),
  // The walk goes a decision deeper than it should.
  ts('graph-depth-three', GRAPH5, QUERIES, 'const DEPTH = 2;', 'const DEPTH = 3;'),
  // ---- the screens
  // Keeper's desk offers Forget to every member of the office.
  web('keeper-forget-offered-all', KEEPER1, 'packages/core/src/views-memory.ts', "canForget: me.member.role === 'owner',", 'canForget: true,'),
  // A second Forget is reported as some other failure, not as already gone.
  web('keeper-forget-gone-unmapped', KEEPER1, 'apps/web/app/app/office/actions.ts', 'code === "conflict" ? "gone" :', 'false ? "gone" :'),
  // Keeper never shows at work in the office scene, and no memory event reaches it.
  web('keeper-scene-idle', KEEPER1, 'apps/web/app/app/office/page.tsx', 'keeper: written.length ? ("drafting" as const)', 'keeper: false ? ("drafting" as const)'),
  // The desk does not say the notes go unused while answers are not live.
  web('keeper-recorded-unsaid', KEEPER1, 'apps/web/components/office/KeeperDesk.tsx', 'note={data.recorded ?', 'note={false ?'),
  // The decision card's words never reach decide(): a note with a number goes through as a plain rejection.
  web('keeper-card-words-dropped', KEEPER2, 'apps/web/app/actions.ts', 'const words = typeof note === "string" && note.trim() ? note : undefined;', 'const words = undefined;'),
  // The card loses the refusal's reason: another script reads as a number.
  web('keeper-note-reason-lost', KEEPER2, 'apps/web/lib/note-errors.ts', '  "note.script": "note_script",', '  "note.script": "note_number",'),
  // The drawer draws a total as a broken chain.
  web('why-total-as-break', WHY1, 'apps/web/components/WhyChain.tsx', '    case "total":\n    case "end":\n', '    case "never":\n'),
  // The drawer draws a break as a plain line: no "Cannot verify" where the chain stops.
  web(
    'why-break-unmarked',
    WHY1,
    'apps/web/components/WhyChain.tsx',
    '      return <CannotVerify>{BREAK[n.label] ? t[BREAK[n.label] as keyof typeof t] : t.noRows}</CannotVerify>;',
    '      return <span>{BREAK[n.label] ? t[BREAK[n.label] as keyof typeof t] : t.noRows}</span>;',
  ),
  // ---- notes in prompts, by mode, and the seed
  // The app's port gives a run the notes whatever the mode: every Ask on the demo shop misses its fixture.
  recorded('mem-recorded-notes-given', MEMREC1, PORT, 'memory: async () => (notesGiven() ? notesFor(app, session) : []),', 'memory: () => notesFor(app, session),'),
  // Recording counts as live: a record run's prompts carry the notes.
  recorded('mem-record-mode-notes', MEMREC2, PORT, 'export const notesGiven = () => appMode() === "live";', 'export const notesGiven = () => appMode() !== "recorded";'),
  // The kirana seed skips its history on the hosted path.
  hosted('seed-history-skipped', ON5, 'db/seed/kirana.ts', "  await (await import('./kirana-history.ts')).seedKiranaHistory(app, { owner, manager, items }); // W2-A: decisions and Keeper's notes\n", ''),
];
