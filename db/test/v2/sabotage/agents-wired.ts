// Red-proofs of W1-A, the idle agents wired (apps/web/test/agents-wired.test.tsx, agents-tick.test.ts, ai-staff.test.tsx,
// and the package_expiry recipe in test/v2/core/recipes/recipes.test.ts): each breaks one thing a gate guards, as a
// source-text mutation applied as vitest loads the module.
import type { Case } from './case.ts';

const WEB = { dir: 'apps/web', config: 'vitest.config.ts' } as const;
const wired = (sabotage: string, test: string, file: string, from: string, to: string): Case => ({
  sabotage,
  file: 'test/agents-wired.test.tsx',
  test,
  ...WEB,
  ts: { file, from, to },
});

const WHY = "AGENTS1 Why on a finding is its desk's answer from the finding's own row, each figure a chip on a cell its run minted; no book row changes";
const FIX = "AGENTS2 Draft the fix leaves each finding's recipe as a draft waiting in Home's tray, pending; nothing reaches the books before approval";
const QUIET = "AGENTS3 Snooze and Dismiss change the finding's status as an owner or a manager, and Home stops showing it; staff are refused; no book row changes";
const BRIEF = "AGENTS4 the tick's narrator writes the brief's lines in Munshi's words, kept only as checked; the office marks them; with no response the template stands";
const REPLY = "AGENTS5 Draft reply leaves a message.reply draft in Home's tray, pending, from a tainted run of the replies desk; nothing is sent";
const ORDER =
  'AGENTS6 Draft order leaves an order.confirm draft on Orders, its request waiting on it, once; a run that drafts nothing leaves no request; no order before approval';
const VOICE =
  'AGENTS7 a voice note is heard from a clip an owner or a manager attached: stored once, labelled as heard, by a tainted run that proposes nothing; staff are refused';
const COPY =
  "AGENTS8 Write the copy fills a campaign's words, each figure a cell; the owner edits them as marks and saves; every version keeps the disclosure; nothing is sent";
const FAILED = 'AGENTS10 a run whose flow throws ends as failed, never as answered';
const DESKS = "AGENTS11 each flow's run lands with its desk, and a run's draft with its run's desk";

const HERO = 'apps/web/lib/server/hero.ts';
const FINDINGS = 'apps/web/app/app/findings/actions.ts';
const PORT = 'apps/web/lib/server/agent-port.ts';
const INBOX = 'apps/web/lib/server/inbox-agents.ts';
const MESSAGING = 'packages/core/src/commands-messaging.ts';

export const AGENTS_WIRED_CASES: Case[] = [
  // ---- a finding's moves
  // Why? explains some other finding (none): the answer is no longer the finding's own.
  wired('agents-why-wrong-finding', WHY, HERO, '() => explainFinding(findingId, {', '() => explainFinding(crypto.randomUUID(), {'),
  // The overdue card's Why explains one customer's finding instead of the card.
  wired('agents-card-why-first-id', WHY, FINDINGS, 'turn: target.card ? await whyCard(', 'turn: false ? await whyCard('),
  // A drafted fix approves itself: a book row is written before any person decides.
  wired(
    'agents-fix-auto-approves',
    FIX,
    HERO,
    'out.push(r.kind === "proposed" ? { kind: "proposed", draftId: r.draftId } : r);',
    'if (r.kind === "proposed") await (await import("@munshi/core")).decide(await (await import("./db")).appPool(), session, r.draftId, "approved").catch(() => {});\n      out.push(r.kind === "proposed" ? { kind: "proposed", draftId: r.draftId } : r);',
  ),
  // A partial batch of fixes says everything was drafted.
  wired('agents-fix-partial-hidden', FIX, FINDINGS, 'made === out.length ? "fixDrafted" : "fixSome"', '"fixDrafted"'),
  // The tray drops reminders: the drafted fix waits nowhere a person sees it.
  wired(
    'agents-tray-hides-reminders',
    FIX,
    'packages/core/src/views-home.ts',
    "export const TRAY_COMMANDS = ['customer.remind', 'package.expire', 'message.reply'] as const;",
    "export const TRAY_COMMANDS = ['package.expire', 'message.reply'] as const;",
  ),
  // The tray offers Approve to a member whose role does not hold the command.
  wired('agents-tray-staff-decides', FIX, 'apps/web/lib/server/home.ts', 'canDecide: me.mayRun.has(d.command),', 'canDecide: true,'),
  // Snooze answers "snoozed" without moving the finding.
  wired('agents-snooze-dropped', QUIET, FINDINGS, 'await snoozeFinding(await appPool(), who.session, who.target.ids, days);', 'void days;'),
  // Dismiss answers "dismissed" without moving the finding.
  wired('agents-dismiss-dropped', QUIET, FINDINGS, 'await dismissFinding(await appPool(), who.session, who.target.ids, reason);', 'void reason;'),
  // Core lets counter staff snooze or dismiss.
  wired('agents-quiet-staff-allowed', QUIET, 'packages/core/src/findings.ts', "if (rows[0]?.role !== 'owner' && rows[0]?.role !== 'manager') throw new CoreError('refused');", ''),
  // A batch is no longer one transaction: what could move moves, and the rest is skipped.
  wired('agents-batch-split', QUIET, 'packages/core/src/findings.ts', "if (rowCount !== 1) throw new CoreError('not_found');", 'if (rowCount !== 1) continue;'),

  // ---- the brief
  // The narrator's answer never reaches core: the brief stays in fixed words.
  wired('agents-narrator-dropped', BRIEF, PORT, 'if (reply.kind === "answer") return { outcome: "answered"', 'if (reply.kind === ("never" as string)) return { outcome: "answered"'),
  // Only high and critical findings are narrated again: the demo seed's brief stays in fixed words.
  wired(
    'agents-brief-severity-only',
    BRIEF,
    'packages/core/src/brief.ts',
    'const narrated = ranked.rows;',
    "const narrated = ranked.rows.filter((r) => r.severity?.kind === 'text' && (r.severity.txt === 'high' || r.severity.txt === 'critical'));",
  ),
  // The app's narrator that throws after its model call records no call.
  wired('agents-narrator-failure-uncounted', BRIEF, PORT, 'return { outcome: "failed", modelCalls: calls() };', 'return { outcome: "failed", modelCalls: 0 };'),
  // A narrator that throws is recorded as an abstention, not a failure.
  wired('agents-brief-failure-hidden', BRIEF, 'packages/core/src/brief.ts', "({ outcome: 'failed', modelCalls: 0 })", "({ outcome: 'abstained', modelCalls: 0 })"),

  // ---- the inbox
  // A reply's run reads the customer's words untainted.
  wired('agents-reply-untainted', REPLY, 'packages/agent/src/inbox.ts', 'const o = { ...opts, port: tappedPort(opts.port, "message.reply") };', 'const o = opts;'),
  // Core accepts a second reply to a message while the first waits.
  wired('agents-reply-twice-core', REPLY, 'packages/core/src/approvals.ts', "if (waiting.length) throw new CoreError('conflict', { fields: ['messageId'] });", ''),
  // The order's request is left waiting on nothing.
  wired('agents-order-request-undrafted', ORDER, INBOX, 'await requestDrafted(pool, session, request.requestId, r.draftId);', 'void requestDrafted;'),
  // A second "Draft order" drafts a second order.confirm.
  wired('agents-order-twice', ORDER, INBOX, 'if (request.drafted) return { note: "orderAlready", ok: false };', ''),
  // A request the tap made, from which nothing was drafted, is left waiting.
  wired('agents-order-orphan', ORDER, INBOX, 'if (request.created) await requestUndrafted(pool, session, request.requestId);', ''),
  // The clip the person attached never reaches the voice model.
  wired('agents-voice-no-clip', VOICE, INBOX, 'deps: agentDeps("inbox"), media: wav }', 'deps: agentDeps("inbox") }'),
  // The voice run reads the customer's words untainted.
  wired('agents-voice-untainted', VOICE, INBOX, 'tappedPort(port, "message.reply")', 'port'),
  // Core lets counter staff store a clip's words.
  wired('agents-clip-staff-allowed', VOICE, 'packages/core/src/inbox-party.ts', "if (!OWN_CLIP.includes(rows[0]?.role ?? '')) throw new CoreError('refused');", ''),
  // A voice note's heard words show as if the customer typed them.
  wired('agents-heard-unlabelled', VOICE, 'packages/core/src/views-office.ts', "m.kind = 'audio' and m.transcript is not null as heard,", 'false as heard,'),
  // A note the voice model could not hear ends its run as answered.
  wired('agents-hear-refusal-answered', VOICE, INBOX, 'if ("refused" in w) await run.port.trace({ kind: "abstain", label: w.refused, ids: [], ms: 0 });', ''),

  // ---- campaigns
  // A saved copy keeps its marks instead of its cells.
  wired('agents-copy-marks-kept', COPY, 'apps/web/lib/copy-marks.ts', 'return bad ? null : body;', 'return bad ? null : text;'),
  // A mark that names no figure is saved (as nothing) instead of refused.
  wired('agents-copy-unknown-mark', COPY, 'apps/web/lib/copy-marks.ts', 'if (!token) bad = true;', ''),
  // A person's edit of copy Munshi wrote goes out without the disclosure line.
  wired('agents-disclosure-dropped', COPY, MESSAGING, "const discloses = (k: Copy) => k.author === 'run' || k.ai_written;", "const discloses = (k: Copy) => k.author === 'run';"),

  // ---- every run
  // A run whose flow threw is ended as if it had answered.
  wired('agents-run-failed-unrecorded', FAILED, PORT, 'const outcome = failed ? "failed" : has("propose")', 'const outcome = has("propose")'),
  // Every run is filed under its trigger's default desk, whatever the flow names.
  wired('agents-run-desk-ignored', DESKS, PORT, '[trigger, desk],', '[trigger, DESK[trigger]],'),
  // A run's draft is filed under no desk.
  wired('agents-draft-desk-unfilled', DESKS, 'packages/core/src/approvals.ts', '(select r.desk from ai.run r where r.id = $7::uuid))', 'null)'),

  // ---- the package_expiry recipe against core's real customer.remind
  {
    sabotage: 'agents-package-remind-refused',
    file: 'test/v2/core/recipes/recipes.test.ts',
    test: "RCP package expiry → customer.remind (package_expiring): its figure is the holding's current value_left cell, and core's own command accepts it",
    config: 'vitest.v2.config.ts',
    ts: { file: MESSAGING, from: "return cited && rows[0]?.query_name === 'package.balance' && figure.col === 'value_left' && theirs ? [] : ['figure'];", to: "return ['figure'];" },
  },
  // ---- the tick and AI staff
  // The tick runs the back office with no narrator.
  {
    sabotage: 'agents-tick-no-narrator',
    file: 'test/agents-tick.test.ts',
    test: "AGENTS9 an authorized tick runs the back office with the brief's narrator",
    ...WEB,
    ts: { file: 'apps/web/app/api/internal/tick/route.ts', from: '{ narrate: briefNarrator(pool) }', to: '{}' },
  },
  // AI staff lists the desks no code runs.
  {
    sabotage: 'aistaff-no-agent-code-listed',
    file: 'test/ai-staff.test.tsx',
    test: 'AISTAFF3 the desks with no agent code (counter, settlements) leave the picker; every desk an agent runs stays',
    ...WEB,
    ts: { file: 'apps/web/app/app/settings/ai/data.ts', from: '.filter((r) => !NO_AGENT_CODE.has(r.agent))', to: '' },
  },
];
