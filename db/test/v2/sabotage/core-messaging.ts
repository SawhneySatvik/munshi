// Red-proofs of messaging (BP-F3a; test/v2/core/messaging/): each breaks one protection of packages/core/src's outbox,
// inbox or messaging commands, or of packages/adapters/channels, and its named test must fail. The database's own
// messaging rules are red-proved in messaging.ts.
import type { Case } from './case.ts';
import { mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const DIR = 'test/v2/core/messaging';
const OUTBOX = 'packages/core/src/outbox.ts';
const COMMANDS = 'packages/core/src/commands-messaging.ts';
const AUDIENCE = 'packages/core/src/queries-campaigns.ts';
const INBOX = 'packages/core/src/inbox.ts';
const CHANNELS = 'packages/adapters/channels';

const W6_ONCE = 'W6 two sweeps at once send a delivery once: the second waits on the first’s claim, then finds it taken';
const W8_RECORDED = 'W8 a recorded delivery is handed only to the recorded sender, even with a WhatsApp adapter wired beside it';
const K4_SCAN = 'K4 the disclosure line’s words are written in one source file only, core’s, and never in the agent';
const K2 = 'K2 a campaign reaches only the consenting customer of five planted ones: never asked, withdrawn, STOP after consent, erased';
const K3_COPY = 'K3 copy carries figures as refs only: a typed number, a number word or a bare handle is refused, a ref to a cell passes and renders';
const K3_CITED = 'K3 a ref in the copy that the draft does not cite is refused at proposal';
const K4_LINE = 'K4 a run’s copy ends with the disclosure line, written by code, in the approved message and the test send alike';
const K5 = 'K5 an audience of the same size but other customers at approval makes the campaign draft stale, and nothing is sent';
const K6 = 'K6 a customer re-linked to a new phone drops out of the audience until the new phone consents';
const PURPOSE = 'consent by purpose: a reminder needs service consent, and the database’s refusal reaches the caller as a code; a campaign’s audience needs marketing';
const W7 = 'W7 a STOP, an erasure, a withdrawal or a re-link between approval and send ends the delivery blocked, a passed deadline expired, an erased address frozen; only the untouched one is sent';
const CH1_GRANT = 'CH1 on a live deploy from a real session, no grant means recorded: the WhatsApp adapter is never called; with the grant and a listed recipient it is called once';
const CH1_POST = 'CH1 a self-serve shop’s approved Instagram post goes nowhere: recorded; posted only once the superadmin grants Instagram and names the account';
const CH1_WITHDRAWN = 'CH1 a grant withdrawn makes the next send recorded again, its recipients still listed';
const W5 = 'W5 a listed customer whose 24-hour window closed before the send is held as needs_window, unsent';
const W2W8 = 'W2 W4 W8 a message is stored only through a listed number, once per provider id, its sender as the contact’s own E.164';
const STOP_WORDS = 'STOP every stop word is an opt-out, a mention of one is not; an opt-out drops its customer from the next audience at once';
const STOP_HANDLED = 'STOP an opt-out is handled only by the withdrawal naming it, from the same contact, in one transaction';
const EX2_TEXT = 'EX2 a text message’s figures are read by core from their spans and re-read by the database; what neither can read fills nothing';
const W1 = 'W1 a webhook body is accepted only with its own signature: a missing, malformed, forged, other-body or other-secret one is refused';
const ERROR_CODE = 'WhatsApp Cloud sends a text in Meta’s shape and keeps only an error’s numeric code, never its text';
const IG_ACCOUNT = 'Instagram posts only for a configured account the shop’s grant names, with its card: an unknown account or no card posts nothing';
const LIVE_ONLY = 'a deploy gets the real senders only when its send mode is live; every other gets the recorded sender alone';
const TEST_SEND = 'a test send reaches the member’s own phone through the outbox and writes no book row';
const W3_BOOKS = 'W3 the webhook’s core path writes no book row: the books are unchanged across text, audio, a STOP, a replay, a stranger and statuses';
const W3_SCAN = 'W3 inbox.ts, which the webhook imports, reaches no command runner, no app pool and no @munshi value, directly or through another file';
const CH1_SCAN = 'CH1 no listed recipient’s phone number is in any platform.* row, with or without its plus';
const REPLY = 'a reply goes to the customer whose phone wrote, under an approved draft, within the 24 hours after the message';

const BY_CHANNEL: [string, string] = [
  "const send = (d.mode === 'recorded' ? channels.recorded : d.channel === 'instagram' ? channels.instagram : channels.whatsapp) as Sender;",
  "const send = (d.channel === 'instagram' ? channels.instagram : (channels.whatsapp ?? channels.recorded)) as Sender;",
];

const ts = (sabotage: string, file: string, test: string, source: string, from: string, to: string): Case => ({
  sabotage,
  file: `${DIR}/${file}`,
  test,
  config: V2,
  ts: { file: source, from, to },
});

export const CORE_MESSAGING_CASES: Case[] = [
  // the claim's answer ignored: a sweep that lost the claim sends anyway
  ts('v2-f3a-claim-dropped', 'outbox.test.ts', W6_ONCE, OUTBOX, 'if (claimed.rowCount !== 1) return null; // another sweep holds it', ''),
  // the adapter chosen by channel, not by the mode the database derived
  ts('v2-f3a-adapter-by-channel', 'outbox.test.ts', W8_RECORDED, OUTBOX, ...BY_CHANNEL),
  ts('v2-f3a-ch1-by-channel', 'ch1.test.ts', CH1_GRANT, OUTBOX, ...BY_CHANNEL),
  ts('v2-f3a-ch1-post-by-channel', 'ch1.test.ts', CH1_POST, OUTBOX, ...BY_CHANNEL),
  // the database's own rule broken under the end-to-end test: a withdrawn grant read past, so a listed recipient
  // derives `pending` and reaches the adapter
  {
    sabotage: 'v2-f3a-ch1-withdrawn',
    file: `${DIR}/ch1.test.ts`,
    test: CH1_WITHDRAWN,
    config: V2,
    sql: mutate('ops.delivery_derive()', 'where g.tenant_id = new.tenant_id and g.channel = case', 'where g.granted and g.tenant_id = new.tenant_id and g.channel = case'),
  },
  ts('v2-f3a-w5-window', 'ch1.test.ts', W5, OUTBOX, "if (mode === 'cloud_api' && !r.window && !templated) return { status: 'needs_window' };", ''),
  // a STOP left out of the audience: the database does not know a STOP, so the message goes
  ts('v2-f3a-k2-stop', 'campaign.test.ts', K2, AUDIENCE, '               where not exists (select 1 from ops.inbound_message i', '               where true or not exists (select 1 from ops.inbound_message i'),
  // a withdrawal read as consent: the audience then names a customer the database refuses, and the approval fails
  ts('v2-f3a-k2-granted', 'campaign.test.ts', K2, AUDIENCE, ') k on k.granted', ') k on true'),
  ts('v2-f3a-k3-detector', 'campaign.test.ts', K3_COPY, COMMANDS, '...answerRules(text)])]', '])]'),
  ts('v2-f3a-k3-uncited', 'campaign.test.ts', K3_CITED, COMMANDS, ' || (may && !may.has(formatRef(ref)))', ''),
  ts('v2-f3a-k4-line', 'campaign.test.ts', K4_LINE, COMMANDS, 'return disclose ?', 'return false ?'),
  // K5's red-proof: compare only how many
  ts('v2-f3a-k5-count-only', 'campaign.test.ts', K5, COMMANDS, 'stored.join() !== now.join()', 'stored.length !== now.length'),
  // K6's red-proof: consent keyed on the customer alone
  ts('v2-f3a-k6-customer-only', 'campaign.test.ts', K6, AUDIENCE, ' and k.contact_id = cur.contact_id', ''),
  ts('v2-f3a-purpose', 'campaign.test.ts', PURPOSE, AUDIENCE, " and k.purpose = 'marketing'", ''),
  ts('v2-f3a-reply-sender', 'campaign.test.ts', REPLY, COMMANDS, "if (!r?.from_address || r.from_address !== (await currentPhone(c, p.customerId))?.phone) bad.push('customerId');", ''),
  // the send-time recheck loses one clause each
  ts('v2-f3a-w7-stop', 'recheck.test.ts', W7, OUTBOX, ' || r.stopped', ''),
  ts('v2-f3a-w7-reachable', 'recheck.test.ts', W7, OUTBOX, ' || !r.reachable', ''),
  ts('v2-f3a-w7-consent', 'recheck.test.ts', W7, OUTBOX, ' || !r.consented', ''),
  ts('v2-f3a-w7-expired', 'recheck.test.ts', W7, OUTBOX, 'if (!r || r.expired) return', 'if (!r) return'),
  // W4's red-proof: the route found without the number's HMAC, so a stranger's message lands in a listed shop
  ts('v2-f3a-w4-route', 'inbox.test.ts', W2W8, INBOX, "where phone_hmac = $1 and erased_at is null'", "where erased_at is null and $1::bytea is not null'"),
  ts('v2-f3a-w2-replay', 'inbox.test.ts', W2W8, INBOX, 'on conflict (tenant_id, provider_message_id) do nothing returning id', 'returning id'),
  // Meta's `from` kept without its plus: the route, the STOP filter and erasure no longer meet the contact
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of inbox.ts, not a template
  ts('v2-f3a-w8-from', 'inbox.test.ts', W2W8, INBOX, '? `+${digits}` : null', '? digits : null'),
  ts('v2-f3a-stop-words', 'inbox.test.ts', STOP_WORDS, INBOX, "new Set(['stop', 'unsubscribe', 'band karo', 'बंद करो'])", "new Set(['stop'])"),
  ts(
    'v2-f3a-stop-handled',
    'inbox.test.ts',
    STOP_HANDLED,
    COMMANDS,
    "if (stop) await c.query(`update ops.inbound_message set status = 'handled' where id = $1`, [i.evidenceMessageId]);",
    '',
  ),
  ts('v2-f3a-stop-evidence', 'inbox.test.ts', STOP_HANDLED, COMMANDS, "if (msg.from_address !== contact.phone) throw new CoreError('invalid', { fields: ['evidenceMessageId'] });", ''),
  // a digit span stored with its rupee sign: the database cannot re-read it, so the figure is lost
  ts('v2-f3a-ex2-narrow', 'inbox.test.ts', EX2_TEXT, INBOX, "if (read.field !== 'date' && read.parsedAs === 'digits') {", 'if (false) {'),
  ts('v2-f3a-ex2-milli', 'inbox.test.ts', EX2_TEXT, INBOX, '{ num: read.count * 1000, day: null, parsedAs: read.parsedAs }', '{ num: read.count, day: null, parsedAs: read.parsedAs }'),
  // W1's red-proof: skip the compare
  ts('v2-f3a-w1-compare', 'adapters.test.ts', W1, `${CHANNELS}/whatsapp.ts`, "return timingSafeEqual(expected, Buffer.from(header.slice('sha256='.length), 'hex'));", 'return true;'),
  ts(
    'v2-f3a-error-text',
    'adapters.test.ts',
    ERROR_CODE,
    `${CHANNELS}/whatsapp.ts`,
    'return { ok: false, errorCode: numericCode(answer?.error?.code) };',
    "return { ok: false, errorCode: String(answer?.error?.code ?? '') && JSON.stringify(answer?.error) };",
  ),
  ts(
    'v2-f3a-ig-account',
    'adapters.test.ts',
    IG_ACCOUNT,
    `${CHANNELS}/instagram.ts`,
    'const account = m.accountRef && Object.hasOwn(cfg.accounts, m.accountRef) ? cfg.accounts[m.accountRef] : undefined;',
    'const account = Object.values(cfg.accounts)[0];',
  ),
  ts('v2-f3a-live-only', 'adapters.test.ts', LIVE_ONLY, `${CHANNELS}/index.ts`, "return sendMode === 'live' ? { recorded, ...live } : { recorded };", 'return { recorded, ...live };'),
  // harness-level: the disclosure's words planted in an agent file's scanned text
  { sabotage: 'v2-f3a-k4-scan', file: `${DIR}/campaign.test.ts`, test: K4_SCAN, config: V2 },
  // harness-level: a book row written mid-run, a command runner planted in inbox.ts's scanned text, a phone planted in
  // a platform row
  { sabotage: 'v2-f3a-w3-books', file: `${DIR}/inbox.test.ts`, test: W3_BOOKS, config: V2 },
  { sabotage: 'v2-f3a-w3-scan', file: `${DIR}/inbox.test.ts`, test: W3_SCAN, config: V2 },
  { sabotage: 'v2-f3a-ch1-platform-scan', file: `${DIR}/ch1.test.ts`, test: CH1_SCAN, config: V2 },
  // harness-level: a book row written between the two counts, so the count is shown to see one
  { sabotage: 'v2-f3a-test-send-book', file: `${DIR}/outbox.test.ts`, test: TEST_SEND, config: V2 },
];
