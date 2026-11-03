import type { Case } from './case.ts';

export const PAYTM_SEED_CASES: Case[] = [
  {
    sabotage: 'v2-elite-attendance-includes-today',
    file: 'test/v2/core/seed/elite-attendance.test.ts',
    test: 'SHOWATTENDANCE Elite attendance ends before today at the month boundary and after it',
    config: 'vitest.v2.config.ts',
    ts: {
      file: 'db/seed/elite.ts',
      from: 'for (let day = periodStart; day <= attendanceEnd; day = addDays(day, 1)) {',
      to: 'for (let day = periodStart; day <= periodEnd; day = addDays(day, 1)) {',
    },
  },
  {
    sabotage: 'v2-platform-stale-digest-refusal',
    file: 'test/console.test.tsx',
    test: 'approval is refused for a wrong or stale digest, and for a channel grant without a fresh, unused code; nothing is written until it holds',
    dir: 'apps/web',
    config: 'vitest.config.ts',
    ts: {
      file: 'packages/core/src/platform.ts',
      from: "if (diff.digest !== opts.digest || diff.stray.length) throw new CoreError('conflict');",
      to: "if (false) throw new CoreError('conflict');",
    },
  },
  {
    // The overdue udhaar given 20 days later falls due 25 days ago: the key's 45 days no longer holds.
    sabotage: 'v2-bansal-overdue-moved',
    file: 'test/v2/core/seed/bansal.test.ts',
    test: 'PAYTMSEED the watchers find exactly the Bansal key situations, and the shelf gap is due for reorder',
    config: 'vitest.v2.config.ts',
    ts: { file: 'db/seed/bansal.ts', from: 'const OVERDUE_DAY = -75;', to: 'const OVERDUE_DAY = -55;' },
  },
  {
    // Three decimals parse: the malformed amount previews as a line and the refusal by line number is gone.
    sabotage: 'v2-settle-malformed-parses',
    file: 'test/v2/core/settlements/settle.test.ts',
    test: 'SETTLE1 a malformed line is refused with its line number while the rest previews; recording refuses the file',
    config: 'vitest.v2.config.ts',
    ts: { file: 'packages/core/src/settlements.ts', from: 'const RUPEES = /^(\\d{1,9})(?:\\.(\\d{1,2}))?$/;', to: 'const RUPEES = /^(\\d{1,9})(?:\\.(\\d{1,3}))?$/;' },
  },
  {
    // The net taken as the file states it, not re-derived as gross less fees.
    sabotage: 'v2-settle-net-not-derived',
    file: 'test/v2/core/settlements/settle.test.ts',
    test: 'SETTLE2 amounts are re-derived on the server: a net that is not gross less fees is refused, and a total the caller adds is refused',
    config: 'vitest.v2.config.ts',
    ts: { file: 'packages/core/src/settlements.ts', from: 'n === null || n !== g - f || n === 0', to: 'n === null || n === 0' },
  },
  {
    // Counter staff given the command and admitted by the import's guard.
    sabotage: 'v2-settle-staff-imports',
    file: 'test/v2/core/settlements/settle.test.ts',
    test: 'SETTLE3 only an owner or a manager imports; counter staff are refused and nothing is written',
    config: 'vitest.v2.config.ts',
    sql: `insert into ref.command_authority (command, role) values ('settlement.import', 'staff');
          create or replace function ops.import_file_guard() returns trigger language plpgsql
            set search_path = pg_catalog, pg_temp as $$
          begin
            new.imported_by := nullif(current_setting('munshi.actor_id', true), '')::uuid;
            new.imported_at := clock_timestamp();
            return new;
          end $$;`,
  },
  {
    // A settlement written with no audit row.
    sabotage: 'v2-settle-audit-off',
    file: 'test/v2/core/settlements/settle.test.ts',
    test: 'SETTLE4 the preview shows each line against the books; recording writes each new SETTLED line once, with one audit row and a balanced journal entry each',
    config: 'vitest.v2.config.ts',
    sql: 'alter table books.settlement disable trigger z_audit;',
  },
  {
    // A settlement written with no journal entry.
    sabotage: 'v2-settle-no-journal',
    file: 'test/v2/core/settlements/settle.test.ts',
    test: 'SETTLE4 the preview shows each line against the books; recording writes each new SETTLED line once, with one audit row and a balanced journal entry each',
    config: 'vitest.v2.config.ts',
    ts: { file: 'packages/core/src/commands-trade.ts', from: "await journal(ctx, i.receivedOn, 'settlement',", to: "false && journal(ctx, i.receivedOn, 'settlement'," },
  },
  {
    // ON_HOLD lines recorded like SETTLED ones.
    sabotage: 'v2-settle-on-hold-recorded',
    file: 'test/v2/core/settlements/settle.test.ts',
    test: 'SETTLE4 the preview shows each line against the books; recording writes each new SETTLED line once, with one audit row and a balanced journal entry each',
    config: 'vitest.v2.config.ts',
    ts: { file: 'packages/core/src/settlements.ts', from: "if (l.status !== 'SETTLED' || done.has(l.line)) continue;", to: 'if (done.has(l.line)) continue;' },
  },
  {
    // The file's sha256 is not looked up: the same file is imported again.
    sabotage: 'v2-settle-sha-ignored',
    file: 'test/v2/core/settlements/settle.test.ts',
    test: 'SETTLE5 the import is idempotent: the same file records 0, and another file with the same UTRs and days records 0',
    config: 'vitest.v2.config.ts',
    ts: { file: 'packages/core/src/settlements.ts', from: 'if (seen[0]) return { importId: seen[0].id };', to: 'if (seen[0] && i.sha256 === "") return { importId: seen[0].id };' },
  },
  {
    // A line whose UTR or day the books hold is recorded again.
    sabotage: 'v2-settle-utr-day-ignored',
    file: 'test/v2/core/settlements/settle.test.ts',
    test: 'SETTLE5 the import is idempotent: the same file records 0, and another file with the same UTRs and days records 0',
    config: 'vitest.v2.config.ts',
    ts: { file: 'packages/core/src/settlements.ts', from: "if (l.status !== 'SETTLED' || done.has(l.line)) continue;", to: "if (l.status !== 'SETTLED') continue;" },
  },
  {
    // A payout two days late counted as within T+2: the Bansal key's missing day is not found.
    sabotage: 'v2-bansal-missing-window',
    file: 'test/v2/core/seed/bansal.test.ts',
    test: 'PAYTMSEED the watchers find exactly the Bansal key situations, and the shelf gap is due for reorder',
    config: 'vitest.v2.config.ts',
    ts: { file: 'packages/core/src/queries-settlements.ts', from: "'($1::date - 30)', '($1::date - 3)'", to: "'($1::date - 30)', '($1::date - 4)'" },
  },
  {
    // The Bansal short payout recorded in full: the key's short day is not found.
    sabotage: 'v2-bansal-short-paid',
    file: 'test/v2/core/seed/bansal.test.ts',
    test: 'PAYTMSEED the watchers find exactly the Bansal key situations, and the shelf gap is due for reorder',
    config: 'vitest.v2.config.ts',
    ts: { file: 'db/seed/bansal.ts', from: 'amountMinor: amount - (d === SHORT_DAY ? SHORT_MINOR : 0),', to: 'amountMinor: amount,' },
  },
  {
    // The action takes rows the browser posts beside the file: the tampered payout is recorded.
    sabotage: 'v2-settle-web-client-rows',
    file: 'test/settlements.test.tsx',
    test: "SETTLEWEB a tampered total beside the file is ignored: the payout recorded is the file's",
    dir: 'apps/web',
    config: 'vitest.config.ts',
    ts: {
      file: 'apps/web/app/app/settlements/actions.ts',
      from: ': await statementOf(form.get("statement"));',
      to: ': form.get("rows") ? { sha256: "0".repeat(64), rows: JSON.parse(String(form.get("rows"))) as string[][] } : await statementOf(form.get("statement"));',
    },
  },
  {
    // A payout shown as bare text, not its cell.
    sabotage: 'v2-settle-web-unsourced',
    file: 'test/settlements.test.tsx',
    test: 'SETTLEWEB the page is an owner\'s or a manager\'s, and every figure of the books on it is a cell',
    dir: 'apps/web',
    config: 'vitest.config.ts',
    ts: { file: 'apps/web/components/Settlements.tsx', from: '<td className="n">{d.settled ? <Figure cell={d.settled} table /> : "—"}</td>', to: '<td className="n">{d.settled ? `Rs ${d.settled.row}` : "—"}</td>' },
  },
];
