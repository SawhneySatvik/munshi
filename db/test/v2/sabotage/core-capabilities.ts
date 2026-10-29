// Red-proofs of capability switches in core (BP-CAP-1, test/v2/core/capabilities): each breaks one part of
// packages/core/src/capabilities.ts, the check in runCommand, sign-up's pack in members.ts, or capability_guard as core
// reaches it, and its named test must fail.
import type { Case } from './case.ts';
import { mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const REGISTRY = 'test/v2/core/capabilities/cap1-cap3-registry.test.ts';
const COMMANDS = 'test/v2/core/capabilities/cap2-commands.test.ts';
const SWITCHES = 'test/v2/core/capabilities/cap4-switches.test.ts';
const CAPS = 'packages/core/src/capabilities.ts';
const RUN = 'packages/core/src/commands.ts';
const MEMBERS = 'packages/core/src/members.ts';

const CAP1_ROWS = 'CAP1 every command core registers has its capability rows, each naming a known command and capability';
const CAP1_NONE = 'CAP1 a command with no capability row is refused, never freed';
const CAP3_SAME = 'CAP3 the capability registry is exactly ref.capability';
const CAP3_TYPE = 'CAP3 the capability registry names no business type';
const CAP2_ALL = 'CAP2 with every capability off, each command with a start row refuses and each finish-only command runs, every *.reverse included';
const CAP2_ONE = 'CAP2 with one capability off, a command refuses only on its own start row for it; its parts and finish rows run';
const CAP2_START = 'CAP2 through runCommand: with buying off its start commands refuse and write nothing; switched on again, the latest switch wins';
const CAP2_FINISH =
  'CAP2 a finish command runs with its capability off: a repayment with credit off, a supplier payment with buying off, a sale with no loyalty, packages, holds or bookings';
const CAP2_REPLAY =
  "CAP2 the check runs in the command's own transaction after a replay returns: a recorded request replays with buying off, a refused one claims no key";
const CAP2_RACE = 'CAP2 a command waits for a switch in flight and, once the switch-off commits, is refused';
const CAP4_RULES =
  'CAP4 through core: a switch-on with a requirement off and a switch-off while a dependant is on are refused (MS019); each switch is audited and writes no book row';
const CAP4_WHO = 'CAP4 only an active owner switches; an unknown code never reaches the database';
const SIGNUP =
  "CAP4 sign-up writes the chosen pack: kirana 11, salon 13, boutique (apparel) 16 switches, in the creation transaction, each the owner's own and audited";
const CAN = "can() reads the latest switch inside the page's one transaction, and a capability that needs the platform's grant only once it is granted";

const ts = (sabotage: string, file: string, test: string, source: string, from: string, to: string): Case => ({
  sabotage,
  file,
  test,
  config: V2,
  ts: { file: source, from, to },
});
const sql = (sabotage: string, file: string, test: string, text: string): Case => ({ sabotage, file, test, config: V2, sql: text });

const CLAIM = "const claim = key === undefined ? undefined : await claimKey(c, session.memberId, key, name, p);\n    if (claim && 'replay' in claim) return claim.replay;";
const BODY = '    const result = await execute(c, d, p);\n';
const CHECK = '    await refuseSwitchedOff(c, name);\n';
const LAST = "  'variants',\n] as const;";
const SHOP = "    await c.query('insert into ops.shop (tenant_id, id, name) values ($1, $2, $3)', [session.tenantId, shopId, i.shopName]);\n";
const PACK_ORDER = '        order by exists (select 1 from ref.capability_requires r where r.capability = p.capability), p.capability`,';

export const CORE_CAPABILITIES_CASES: Case[] = [
  // CAP1: one row gone (BLUEPRINT's red-proof), and a command with no row let through
  sql(
    'v2-cap1-core-row-deleted',
    REGISTRY,
    CAP1_ROWS,
    `do $sabotage$ begin
       delete from ref.command_capability where command = 'stock.waste';
       if not found then raise exception 'sabotage: no ref.command_capability row for stock.waste'; end if;
     end $sabotage$;`,
  ),
  ts('v2-cap1-core-fail-open', REGISTRY, CAP1_NONE, CAPS, "if (n === 0) throw new CoreError('capability_off', { fields: ['command'] });", ''),
  // CAP3: a capability missing from the registry; a business type in it (BLUEPRINT's red-proof)
  ts('v2-cap3-registry-short', REGISTRY, CAP3_SAME, CAPS, LAST, '] as const;'),
  ts('v2-cap3-type-literal', REGISTRY, CAP3_TYPE, CAPS, LAST, "  'variants',\n  'kirana',\n] as const;"),
  // CAP2: the check dropped from runCommand (BLUEPRINT's red-proof)
  ts('v2-cap2-no-check', COMMANDS, CAP2_START, RUN, CHECK, ''),
  // a finish row refuses like a start row
  ts('v2-cap2-finish-refuses', COMMANDS, CAP2_ALL, CAPS, "where k.use = 'start'", 'where true'),
  ts('v2-cap2-finish-refuses-run', COMMANDS, CAP2_FINISH, CAPS, "where k.use = 'start'", 'where true'),
  // a part (an extra start row whose capability requires the base) is checked as if it were the base
  ts('v2-cap2-parts', COMMANDS, CAP2_ONE, CAPS, 'where r.capability = k.capability)', 'where false)'),
  ts('v2-cap2-parts-sale', COMMANDS, CAP2_FINISH, CAPS, 'where r.capability = k.capability)', 'where false)'),
  // the earliest switch wins instead of the latest
  ts('v2-cap2-latest', COMMANDS, CAP2_START, CAPS, 'order by s.at desc, s.id desc', 'order by s.at, s.id'),
  // the check before the body: it reads a switch-off in flight as still on, and the command lands after it commits
  ts('v2-cap2-before-body', COMMANDS, CAP2_RACE, RUN, `${BODY}${CHECK}`, `${CHECK}${BODY}`),
  // the check before the replay: a recorded request no longer replays once switched off
  ts('v2-cap2-before-claim', COMMANDS, CAP2_REPLAY, RUN, CLAIM, `await refuseSwitchedOff(c, name);\n    ${CLAIM}`),
  // CAP4 as core surfaces it: capability_guard's rules (BLUEPRINT's red-proof is the dependency check)
  sql('v2-cap4-core-requires', SWITCHES, CAP4_RULES, mutate('ops.capability_guard()',
    "raise exception 'switch refused: % requires %, which is off', new.capability, blocker using errcode = 'MS019';", 'null;')),
  sql('v2-cap4-core-dependant', SWITCHES, CAP4_RULES, mutate('ops.capability_guard()',
    "raise exception 'switch refused: % requires %, so % stays on', blocker, new.capability, new.capability using errcode = 'MS019';", 'null;')),
  sql('v2-cap4-core-audit', SWITCHES, CAP4_RULES, mutate('ops.capability_audit()',
    "jsonb_build_object('capability', new.capability, 'is_on', new.is_on)", "jsonb_build_object('capability', new.capability)")),
  sql('v2-cap4-core-owner', SWITCHES, CAP4_WHO, mutate('ops.capability_guard()', "and m.role = 'owner' and m.active) then", 'and m.active) then')),
  sql('v2-cap4-core-active', SWITCHES, CAP4_WHO, mutate('ops.capability_guard()', "and m.role = 'owner' and m.active) then", "and m.role = 'owner') then")),
  ts('v2-cap4-core-code', SWITCHES, CAP4_WHO, CAPS, "if (!(CAPABILITIES as readonly string[]).includes(capability)) throw new CoreError('invalid', { fields: ['capability'] });", ''),
  // sign-up: no switches; always the kirana pack; requirements not first; the switches in a later transaction
  ts('v2-cap-signup-none', SWITCHES, SIGNUP, MEMBERS, 'where p.business_type = $2', 'where p.business_type = $2 and false'),
  ts('v2-cap-signup-pack', SWITCHES, SIGNUP, MEMBERS, 'where p.business_type = $2', "where p.business_type = 'kirana' and $2::text is not null"),
  ts('v2-cap-signup-order', SWITCHES, SIGNUP, MEMBERS, PACK_ORDER, '        order by p.capability`,'),
  ts('v2-cap-signup-later-tx', SWITCHES, SIGNUP, MEMBERS, SHOP, `${SHOP}  });\n  await withTx(pool, { kind: 'member', session }, async (c) => {\n`),
  // can(): no grant needed; the earliest switch wins; another tenant's context read as this shop's
  ts('v2-cap-can-no-grant', SWITCHES, CAN, CAPS, 'if (!r.is_on || !r.needs_grant) return r.is_on;', 'return r.is_on;'),
  ts('v2-cap-can-latest', SWITCHES, CAN, CAPS, 'order by s.at desc, s.id desc', 'order by s.at, s.id'),
  ts('v2-cap-can-context', SWITCHES, CAN, CAPS, "if (r.ctx !== session.tenantId) throw new CoreError('refused');", ''),
];
