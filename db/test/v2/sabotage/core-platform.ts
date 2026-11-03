// Red-proofs of the platform core and its CLI (test/v2/core/platform). Where the database still refuses the fault a core
// sabotage introduces, the case breaks the database's half instead (sql), so the test is shown to depend on it.
import type { Case } from './case.ts';
import { asOwner, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const DIR = 'test/v2/core/platform';
const PLATFORM = 'packages/core/src/platform.ts';
const TOTP = 'packages/core/src/platform-totp.ts';
const CLI = 'db/src/platform-cli.ts';
const sql = (file: string, test: string, sabotage: string, body: string): Case => ({ sabotage, file: `${DIR}/${file}`, test, config: V2, sql: body });
const ts = (file: string, test: string, sabotage: string, target: string, from: string, to: string): Case => ({
  sabotage,
  file: `${DIR}/${file}`,
  test,
  config: V2,
  ts: { file: target, from, to },
});

const SAME_TX = 'a change executes only when approved in a later transaction than its proposal: proposed and approved in one transaction it is refused, and nothing is written';
const APPROVED = 'a proposal is approved in a later transaction by another operator, or by its proposer, both named; the diff shown is the row written and the next read, and a diff gone stale is refused';
const SIGN_IN = 'an operator signs in only with a valid, unused code: a replayed code, an older code after a newer one, a wrong code and an unknown operator are refused';
const FRESH = 'a channel grant is approved only with a code verified in the last 5 minutes: a re-opened session needs a fresh code, and a replayed code is refused';
const BIND = 'an operator identity is never bound to a shop, and a member identity never becomes an operator';
const LIFECYCLE = 'the first operator is seeded only while none exists; another is added only by an approved change with a fresh code; the last active operator is never deactivated';
const LIMITS = 'a shop runs on its latest shop_config, else a sample shop on the demo default, else off; an approved change is the next call’s answer, under the tenant’s own context only';
const VERIFIED = 'a site is verified only by an approved site_verify change: written directly, under any role or an unapproved change, it stays hidden; approved, the next public read sees it';
const ONLY_SITE = 'a site_verify change moves only site_verified and a shop_config change never moves it: a stale one is refused, not applied';
const CHAIN = 'every proposal, decision and executed write through core is in the platform chain, naming its operator; the chain verifies, and an edited entry breaks it at its seq';
const CODES = 'codes are RFC 6238 (SHA-1, 30-second steps), accepted one step either side and no further; a secret opens only under its key for its own operator';
const CLI_APPROVE = 'the platform CLI’s propose prints the change and its diff; approve prints the exact diff before it asks, writes nothing but on yes, then writes the printed values';
const CLI_PROCESS = 'the platform CLI as a real process lists the change log and exits 1 on a broken platform chain; an unknown option or a missing setting exits 2';

const CODE_ONCE = 'if (used.rowCount !== 1) return false;';

export const CORE_PLATFORM_CASES: Case[] = [
  // approve in the proposing transaction: both of the database's fences (the decision's and the write's) removed
  sql('propose.test.ts', SAME_TX, 'v2-coreplat-same-tx',
    mutate('platform.change_guard()', 'if old.proposed_txid = txid_current() then', 'if false then') +
      mutate('platform.platform_guard()', '\n       or ch.proposed_txid = ch.decided_txid', '')),
  // approve whatever the diff now says, not what was shown
  ts('propose.test.ts', APPROVED, 'v2-coreplat-stale-diff', PLATFORM, 'if (diff.digest !== opts.digest || diff.stray.length)', 'if (diff.stray.length)'),
  // record a shop_config approval but write nothing (the fixture's operator changes still execute)
  ts('propose.test.ts', APPROVED, 'v2-coreplat-not-executed', PLATFORM, "const cols = spec.keys.join(', ');",
    "if (spec.table === 'shop_config') return { changeId: ch.id };\n  const cols = spec.keys.join(', ');"),
  // accept a code twice: the compare-and-set's miss ignored, at sign-in and at an approval
  ts('propose.test.ts', SIGN_IN, 'v2-coreplat-code-twice', PLATFORM, CODE_ONCE, ''),
  ts('propose.test.ts', FRESH, 'v2-coreplat-code-twice-approve', PLATFORM, CODE_ONCE, ''),
  // a session re-opened from its cookie passes for a fresh code
  ts('propose.test.ts', FRESH, 'v2-coreplat-cookie-fresh', PLATFORM, 'mint(rows[0].id, rows[0].operator_id, null)',
    'mint(rows[0].id, rows[0].operator_id, new Date(Date.now() - 60_000).toISOString())'),
  sql('operator.test.ts', BIND, 'v2-coreplat-operator-bind', mutate('ops.login_bind()',
    'if exists (select 1 from ops.subject_summary s where s.provider = new.provider and s.subject = new.subject and s.is_operator) then', 'if false then')),
  // the owner seeds an operator while one exists
  sql('operator.test.ts', LIFECYCLE, 'v2-coreplat-seed-twice', mutate('platform.platform_guard()',
    "(tg_table_name = 'operator' and not exists (select 1 from platform.operator))", "tg_table_name = 'operator'")),
  ts('operator.test.ts', LIFECYCLE, 'v2-coreplat-last-operator', PLATFORM, "if (rows[0]?.n === 0) throw new CoreError('refused');", ''),
  // skip the default merge
  ts('config.test.ts', LIMITS, 'v2-coreplat-no-default', PLATFORM, 'if (sample && dflt) {', 'if (false && sample && dflt) {'),
  ts('config.test.ts', LIMITS, 'v2-coreplat-limits-context', PLATFORM, "if (ctx !== tenantId) throw new CoreError('refused');", ''),
  // set site_verified directly: the guard admits a shop_config row naming any change, approved or not
  sql('verify.test.ts', VERIFIED, 'v2-coreplat-site-direct', mutate('platform.platform_guard()',
    'if ch.id is null or ch.verdict', "if tg_table_name = 'shop_config' and ch.id is not null then null; elsif ch.id is null or ch.verdict")),
  ts('verify.test.ts', ONLY_SITE, 'v2-coreplat-stray', PLATFORM, 'if (diff.digest !== opts.digest || diff.stray.length)', 'if (diff.digest !== opts.digest)'),
  ts('verify.test.ts', ONLY_SITE, 'v2-coreplat-settable', PLATFORM, "if (stray.length) throw new CoreError('invalid', ", "if (false) throw new CoreError('invalid', "),
  sql('chain.test.ts', CHAIN, 'v2-coreplat-unchained', asOwner('drop trigger audit on platform.change;')),
  sql('chain.test.ts', CHAIN, 'v2-coreplat-chain-verify', mutate('platform.verify_chain()', 'return expected;', 'null;')),
  // two steps of drift back
  ts('totp.test.ts', CODES, 'v2-coreplat-drift', TOTP, '[nowStep + 1, nowStep, nowStep - 1]', '[nowStep + 1, nowStep, nowStep - 1, nowStep - 2]'),
  // approve on any answer
  ts('cli.test.ts', CLI_APPROVE, 'v2-coreplat-cli-yes', CLI, "if (answer?.trim() !== 'yes') {", "if (answer === 'never') {"),
  // the spawned process reads the database, so its case is the database's: a chain that always verifies
  sql('cli.test.ts', CLI_PROCESS, 'v2-coreplat-cli-chain', mutate('platform.verify_chain()', 'return expected;', 'null;')),
];
