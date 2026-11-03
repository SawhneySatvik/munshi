// Red-proofs of PayPal (D-079, sandbox; lane L-Y): the DB gates (test/v2/core/paypal/paypal.test.ts, against
// db/schema/24_paypal.sql, whose own cases break the built database), the adapter's (packages/adapters/test/paypal.test.ts),
// the config's (packages/config/test/paypal.test.ts) and the web app's (apps/web/test/paypal*.test.tsx). Each breaks
// one protection; the named test must then fail.
import type { Case } from './case.ts';
import { asOwner, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const DB_TEST = 'test/v2/core/paypal/paypal.test.ts';
const LINK_GUARD = 'ops.paypal_link_guard()';
const COMMAND = 'packages/core/src/commands-paypal.ts';
const SWEEP = 'packages/core/src/jobs-paypal.ts';
const CORE = 'packages/core/src/payments-paypal.ts';
const READS = 'packages/core/src/queries-paypal.ts';
const ADAPTER = 'packages/adapters/payments/paypal.ts';
const ROUTE = 'apps/web/app/api/webhooks/paypal/route.ts';

const P0 = 'PAYPAL0 the pending DDL keeps the build rules: declared indexes, tenant-led keys, exact grants, policies, sealed functions, the seal';
const P1 = 'PAYPAL1 proposing a link calls no PayPal; the approval queues exactly one link under the approver and calls nothing either';
const P2 = 'PAYPAL2 the sweep asks PayPal once, with the draft id as the request id; a second approval or sweep makes no second link; no link without its approval';
const P3 = 'PAYPAL3 the amount is a cell: a typed amount is refused, and so is a figure that is not this customer’s current balance';
const P4 = 'PAYPAL4 a verified paid notification stores one event and writes no book row and no draft; a replay, a partial payment or an unknown link stores nothing';
const P5 = 'PAYPAL5 the recipes draft a PayPal link for an overdue balance and "record this payment" from cells; core takes the record and holds the link while the paid one is unrecorded';
const P6 = 'PAYPAL6 a member drafts "record this payment" by PayPal from the stored event; only its approval writes the payment, once; another currency is never recorded';
const P7 = 'PAYPAL7 one live link per customer: a second is refused while one is live, two at once leave one draft; a cancel closes it at PayPal once';
const P8 = 'PAYPAL8 an invoice link asks only for its sale’s open credit: part-paid the rest, paid nothing; a reversed sale none, and a reversal after the proposal stales it';
const P9 = 'PAYPAL9 the sweep: a database error on one link never blocks the next; two sweeps at once ask PayPal once per link; failed after its attempts; one shop only';
const P10 = 'PAYPAL10 the guards as the roles meet them: the event store (public), the link update branch (jobs, app), the route (jobs)';
const A1 = 'sandbox: one OAuth token for many calls; a new invoice is searched for, created with our number and the request id, and sent for its payer link';
const A2 = 'a retry of the same request finds the invoice PayPal already holds and creates none';
const A3 =
  'a webhook verifies only when PayPal says SUCCESS for our webhook id; the cert URL is never fetched; stale, off-host or bad input is refused unasked';
const A4 = 'recorded mode never calls the network: every method runs with fetch throwing, and a retry gives the same link';
const A5 = 'no client id, secret or token reaches an error, its stack or the console, whatever PayPal answers';
const A6 = 'amounts by digits alone; the paid event keeps PayPal status, a partial payment is not PAID; other events are not read';
const A7 = 'every PayPal call gives up at its timeout; cancel closes an invoice once, and a retry of a cancel PayPal already did is done';
const CFG1 = 'none set is recorded mode; all three is the sandbox; a partial set or a live PAYPAL_ENV is refused, naming settings only';
const W1 = 'recorded mode (no keys): the webhook is a 404 and calls nothing';
const W2 = 'with the sandbox keys, a notification PayPal answers FAILURE for, or one outside the window, is refused before anything is stored';
const W3 =
  'the panel is labelled PayPal sandbox in both languages (recorded: nothing is sent), every digit is in a name or a time, and the strings hold no digit';
const W4 =
  "a Send PayPal link draft shows on the customer's row: its amount the balance cell it cites, Approve for the owner, no second Send, labelled PayPal sandbox";
const W5 = 'a body over the cap is refused before PayPal is asked or the body is used';
const W6 = 'a verified paid event with no readable amount is read back from PayPal; a payment that cannot be stored is never answered 200';

const db = (sabotage: string, test: string, file: string, from: string, to: string): Case => ({ sabotage, file: DB_TEST, test, config: V2, ts: { file, from, to } });
const sql = (sabotage: string, test: string, statement: string): Case => ({ sabotage, file: DB_TEST, test, config: V2, sql: statement });
const pkg = (dir: string, file: string) => (sabotage: string, test: string, src: string, from: string, to: string): Case => ({
  sabotage,
  dir,
  file,
  test,
  config: 'vitest.config.ts',
  ts: { file: src, from, to },
});
const adapter = pkg('packages/adapters', 'test/paypal.test.ts');
const config = pkg('packages/config', 'test/paypal.test.ts');
const web = pkg('apps/web', 'test/paypal.test.tsx');
const webDb = pkg('apps/web', 'test/paypal-credit.test.tsx');

export const PAYPAL_CASES: Case[] = [
  // The schema: an index not led by tenant_id (the old global lookup on the link table).
  sql(
    'v2-paypal-ddl-global-index',
    P0,
    asOwner('drop index ops.paypal_link_paypal_id; create unique index paypal_link_paypal_id on ops.paypal_link (paypal_id) where paypal_id is not null;'),
  ),
  // The payer page's check is the pending DDL's regex with a bound over 255: an error, never a stored URL.
  sql(
    'v2-paypal-payer-url-bound',
    P0,
    asOwner(
      "alter table ops.paypal_link drop constraint paypal_link_payer_url_check; alter table ops.paypal_link add constraint paypal_link_payer_url_check check (payer_url ~ '^https://[^\\s]{1,490}$');",
    ),
  ),
  // The approval's own transaction calls PayPal.
  db(
    'v2-paypal-call-in-approval',
    P1,
    COMMAND,
    '        return { linkId: made.id };',
    "        await (await import('./jobs-paypal.ts')).wiredPayPal()?.createLink({ requestId: d.draft_id, amountMinor: Number(cell.num), currency: cell.currency, reference: made.id });\n        return { linkId: made.id };",
  ),
  // PayPal's request id is not the draft's.
  db('v2-paypal-request-id-not-draft', P2, SWEEP, 'await paypal.createLink({ requestId: l.draft_id,', 'await paypal.createLink({ requestId: l.id,'),
  // The link table's guard is gone, or admits a figure the draft never named, or an inactive approver.
  sql('v2-paypal-link-guard', P2, 'drop trigger guard on ops.paypal_link;'),
  sql('v2-paypal-guard-payload', P2, mutate(LINK_GUARD, " and dr.payload ->> 'figure' = new.figure) then", ') then')),
  sql(
    'v2-paypal-guard-inactive',
    P2,
    mutate(
      LINK_GUARD,
      '           join ops.member m on m.tenant_id = d.tenant_id and m.id = d.decided_by and m.active\n           join ref.command_authority ca on ca.command = dr.command and ca.role = m.role\n          where',
      '           join ops.member m on m.tenant_id = d.tenant_id and m.id = d.decided_by\n           join ref.command_authority ca on ca.command = dr.command and ca.role = m.role\n          where',
    ),
  ),
  // The link's amount is not bound to the cited cell (MINOR-6): core's word alone.
  sql('v2-paypal-amount-cell', P2, mutate(LINK_GUARD, "raise exception 'paypal link refused: the amount is the cited cell''s, in its currency' using errcode = 'MS007';", 'null;')),
  // The figure's own check is skipped: another customer's balance is taken as the amount.
  db('v2-paypal-figure-unchecked', P3, COMMAND, "    bad.push('figure');", '    void 0;'),
  // A replayed notification is stored again.
  db('v2-paypal-replay', P4, CORE, 'on conflict (tenant_id, provider, provider_event_id) do nothing returning id', 'returning id'),
  // The recipe's figure is the finding row's, not the customer's current balance.
  db('v2-paypal-recipe-stale-figure', P5, 'packages/agent/src/recipes.ts', '  const figure = ref(balance.snapshotId, 0, "balance");', '  const figure = ref(f.snapshotId, f.row, "balance");'),
  // "Record this payment" cites the balance, not PayPal's stored notification (whose amount differs from it).
  db('v2-paypal-record-off-event', P6, CORE, "      payloadRefs: { amountMinor: cell('amount') },", "      payloadRefs: { amountMinor: { snapshotId: balance.id, row: 0, col: 'balance' } },"),
  // One live link per customer: the check answers "free" always; or proposals stop serializing.
  db('v2-paypal-live-unchecked', P7, COMMAND, '  return rows.length > 0;', '  return false;'),
  db(
    'v2-paypal-propose-unlocked',
    P7,
    CORE,
    "    await c.query(`select pg_advisory_xact_lock(hashtextextended('munshi.paypal-propose:' || $1 || ':' || $2, 0))`, [by.session.tenantId, draft.customerId]);\n",
    '',
  ),
  // The invoice's open credit ignores repayments and reversals (positive credit only), and never says reversed.
  db(
    'v2-paypal-open-ignores-reversal',
    P8,
    READS,
    // The source's own template text, spelled without a template string.
    '                           and $' + '{' + "live('books.credit_entry', 'c')})",
    '                           and c.amount_minor > 0)',
  ),
  // The sweep: no savepoint per link; no row claim; no end to retries; every shop's links from one shop's approval.
  db('v2-paypal-no-savepoint', P9, SWEEP, "      await c.query('rollback to savepoint paypal_link');\n", ''),
  db('v2-paypal-no-skip-locked', P9, SWEEP, ' for update skip locked`,', '`,'),
  db('v2-paypal-no-max-attempts', P9, SWEEP, 'status = case when attempts + 1 < $3 then status', 'status = case when true then status'),
  db(
    'v2-paypal-sweep-every-shop',
    P9,
    CORE,
    "  return withTx(jobs, { kind: 'system', tenantId }, (c) => sweepPaypalLinks(c));",
    "  return withTx(jobs, { kind: 'system', tenantId }, async (c) => {\n    const all = await c.query<{ t: string }>('select tenant_id::text as t from ops.tenant_directory');\n    for (const r of all.rows) {\n      await c.query(\"select set_config('munshi.tenant_id', $1, true)\", [r.t]);\n      await sweepPaypalLinks(c);\n    }\n    return {};\n  });",
  ),
  // The event's and the route's guards are gone.
  sql('v2-paypal-event-guard', P10, 'drop trigger guard on ops.payment_event;'),
  sql('v2-paypal-route-guard', P10, 'drop trigger guard on ops.paypal_route;'),
  // The adapter.
  adapter('v2-paypal-no-request-id', A1, ADAPTER, "        ...(requestId ? { 'paypal-request-id': requestId } : {}),\n", ''),
  adapter('v2-paypal-no-search-first', A2, ADAPTER, '      let inv = obj((Array.isArray(found.items) ? found.items : [])[0]);', '      let inv = obj(undefined);'),
  adapter('v2-paypal-verify-always', A3, ADAPTER, "        return answer.verification_status === 'SUCCESS';", '        return true;'),
  adapter('v2-paypal-no-window', A3, ADAPTER, '  return Number.isFinite(at) && Math.abs(now - at) <= WEBHOOK_WINDOW_MS;', '  return Number.isFinite(at);'),
  adapter('v2-paypal-any-cert-host', A3, ADAPTER, " || algo !== 'SHA256withRSA' || !paypalCertUrl(cert)) return false;", ') return false;'),
  adapter('v2-paypal-recorded-network', A4, ADAPTER, '      const paypalId = `REC-', '      await globalThis.fetch(PAYPAL_SANDBOX_BASE).catch(() => undefined);\n      const paypalId = `REC-'),
  adapter('v2-paypal-secret-in-error', A5, ADAPTER, "    if (!res.ok) throw new PayPalError('paypal_auth', res.status);", "    if (!res.ok) throw new Error('paypal auth refused for ' + cfg.clientId);"),
  adapter('v2-paypal-zero-decimal', A6, ADAPTER, ' || ZERO_DECIMAL.has(currency)) throw', ') throw'),
  adapter('v2-paypal-cancel-retry-fails', A7, ADAPTER, " || invoiceState(paypalId, await api('GET', path)).status !== 'CANCELLED') throw err;", ' || true) throw err;'),
  config('v2-paypal-cfg-partial', CFG1, 'packages/config/src/index.ts', "  if (set.length < names.length) throw new ConfigError('config_missing', names.filter((name) => !env[name]));\n", ''),
  // The web app.
  web('v2-paypal-route-recorded-open', W1, ROUTE, '  if (!paypal) return notFound();', '  if (!paypal) return Response.json({ result: "ignored" });'),
  web('v2-paypal-route-unverified', W2, ROUTE, '  if (!(await paypal.verifyWebhook(raw, headers))) return notFound();\n', ''),
  web('v2-paypal-string-digit', W3, 'apps/web/lib/i18n-paypal.ts', '  sendLink: "Send PayPal link",', '  sendLink: "Send PayPal link 2",'),
  web('v2-paypal-recorded-says-sent', W3, 'apps/web/components/PayPalLink.tsx', '            : recorded\n              ? p.sentRecorded\n              : p.sent;', '            : p.sent;'),
  // Recorded mode's short sticker on the panel loses the plain line beside it saying nothing is sent.
  web('v2-paypal-panel-recorded-note-dropped', W3, 'apps/web/components/PayPalSticker.tsx', ' <span className="sticker-note" data-paypal-recorded="">{p.recordedNote}</span>', ''),
  web('v2-paypal-body-uncapped', W5, ROUTE, 'const MAX_BODY = 256_000;', 'const MAX_BODY = 10_000_000;'),
  web('v2-paypal-no-readback', W6, ROUTE, '    if (paid.paidMinor === null || paid.currency === null) {', '    if (false) {'),
  webDb('v2-paypal-panel-no-amount', W4, 'apps/web/lib/server/paypal-panel.ts', 'amount: refOf(d.figure) });', 'amount: null });'),
  webDb('v2-paypal-panel-not-busy', W4, 'apps/web/lib/server/paypal-panel.ts', '  for (const d of waiting) if (d.command === "paypal.request") busyCustomers.add(d.customerId);\n', ''),
];
