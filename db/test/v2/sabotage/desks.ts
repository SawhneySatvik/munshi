// Red-proofs of the office's desks and run log (apps/web/test/desks.test.tsx) and its scene (test/office-scene.test.tsx).
import type { Case } from './case.ts';

const web = { dir: 'apps/web', config: 'vitest.config.ts', file: 'test/desks.test.tsx' };
const scene = { dir: 'apps/web', config: 'vitest.config.ts', file: 'test/office-scene.test.tsx' };
const OFFICE = 'apps/web/components/office/IsometricOffice.tsx';

export const DESKS_CASES: Case[] = [
  {
    // The window widened: the run backdated past seven days is counted (Tally's runs and failures rise).
    sabotage: 'v2-desks-window-widened',
    ...web,
    test: "each cast member's counts are the rows': its runs in the last seven days, their drafts and the decisions on them",
    ts: { file: 'packages/core/src/queries-desks.ts', from: "where r.started_at > now() - interval '7 days'", to: "where r.started_at > now() - interval '30 days'" },
  },
  {
    // ai.run's tenant policy opened: the other shop's run reaches the first shop's desks and log.
    sabotage: 'v2-desks-tenant-leak',
    ...web,
    test: "each cast member's counts are the rows': its runs in the last seven days, their drafts and the decisions on them",
    sql: 'alter policy tenant_isolation on ai.run using (true) with check (true);',
  },
  {
    // A failed latest run shown as idle: the scene invents calm where the rows say blocked.
    sabotage: 'v2-desks-failed-not-blocked',
    ...web,
    test: "the scene's states come from each member's latest run; a shop with no runs shows everyone idle",
    ts: { file: 'apps/web/lib/server/desks.ts', from: 'if (outcome === "failed") return "blocked";', to: 'if (outcome === "failed") return "idle";' },
  },
  {
    // A count typed beside the cells instead of its <Figure>: a digit with no source on the page.
    sabotage: 'v2-desks-count-typed',
    ...web,
    test: "the page shows every count and step timing as a sourced figure, filters the log by member and opens a run's steps",
    ts: { file: 'apps/web/components/office/Desks.tsx', from: '<Figure cell={card.counts[k]} />', to: '{card.counts[k].row}' },
  },
  {
    // A digit typed into the words.
    sabotage: 'v2-desks-words-digit',
    ...web,
    test: "the desks' words carry no digit, and the English ones no Devanagari",
    ts: { file: 'apps/web/lib/i18n-desks.ts', from: 'noRuns: "No runs in the last seven days.",', to: 'noRuns: "No runs in the last 7 days.",' },
  },
  {
    // The run log's window widened: the run backdated past seven days is listed.
    sabotage: 'v2-desks-log-window-widened',
    ...web,
    test: "each cast member's counts are the rows': its runs in the last seven days, their drafts and the decisions on them",
    ts: { file: 'packages/core/src/views-desks.ts', from: "where r.started_at > now() - interval '7 days' and", to: "where r.started_at > now() - interval '30 days' and" },
  },
  {
    // The log's member filter dropped from the read: ?cast=ledger lists everyone's runs.
    sabotage: 'v2-desks-log-filter-dropped',
    ...web,
    test: "the page shows every count and step timing as a sourced figure, filters the log by member and opens a run's steps",
    ts: { file: 'packages/core/src/views-desks.ts', from: '($4::text is null or', to: '($4::text is not null or' },
  },
  {
    // The ?run= guard dropped: a run the log does not show (too old, another shop's, filtered out) opens.
    sabotage: 'v2-desks-run-guard-dropped',
    ...web,
    test: "only a run the log shows opens: not one older than the window, another shop's, or one the filter hides",
    ts: { file: 'packages/core/src/views-desks.ts', from: 'open && UUID.test(open) && log.some((r) => r.id === open)', to: 'open && UUID.test(open)' },
  },
  {
    // Watching widened past the hour: the other shop's two-hour-old watcher run shows Munshi watching, not idle.
    sabotage: 'v2-desks-watching-window-widened',
    ...web,
    test: "the scene's states come from each member's latest run; a shop with no runs shows everyone idle",
    ts: { file: 'packages/core/src/queries-desks.ts', from: "l.started_at > now() - interval '1 hour'", to: "l.started_at > now() - interval '3 hours'" },
  },
  {
    // The agent port's desk mapped to another member: its question run leaves Munshi's card.
    sabotage: 'v2-desks-ask-not-munshi',
    ...web,
    test: 'a run as the agent port writes it today (a question, filed under ask) counts under Munshi',
    ts: { file: 'apps/web/lib/cast.ts', from: '  ask: "munshi",', to: '  ask: "tally",' },
  },
  // The office scene (apps/web/test/office-scene.test.tsx).
  {
    // The scene's bubble draws the design file's sample words instead of the line the page passed in.
    sabotage: 'v2-office-sample-line',
    ...scene,
    test: "the scene draws the app's own lines with their sources, and no sample text",
    ts: { file: OFFICE, from: 'const text = agent.line ? lineText(agent.line.text, w.cannotVerify, 32) : "";', to: 'const text = agent.line ? "Checking ₹1,240 gap" : "";' },
  },
  {
    // A line's figure drawn as given: a number on screen that no stored row backs.
    sabotage: 'v2-office-figure-drawn',
    ...scene,
    test: 'a line with a figure says Cannot verify; the scene shows no digit of its own',
    ts: { file: OFFICE, from: '  if (FIGURE.test(text)) return cannotVerify;', to: '  if (false) return cannotVerify;' },
  },
  {
    // A sample shop's name ships in the scene's words.
    sabotage: 'v2-office-sample-shipped',
    ...scene,
    test: "the office's source carries none of the design file's sample shops, figures or chat",
    ts: { file: 'apps/web/components/office/presets.ts', from: 'preset: { kirana: "Kirana",', to: 'preset: { kirana: "Bansal Super Mart",' },
  },
  {
    // The shop's kind ignored: a salon's office opens in the kirana.
    sabotage: 'v2-office-kind-ignored',
    ...scene,
    test: "the room follows the shop's kind until the owner picks one; the pick is kept in this browser only",
    ts: { file: 'apps/web/components/office/presets.ts', from: '  if (kind === "salon") return "salon";', to: '  if (false) return "salon";' },
  },
];
