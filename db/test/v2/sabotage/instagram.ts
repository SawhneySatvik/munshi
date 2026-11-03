// Red-proofs of Instagram's inbound storage and its post's card (lane L-IG): the webhook's storage through core's
// receiveInstagram (apps/web/test/webhook-instagram.test.ts) and the card route, the outbox's Instagram wiring, the
// sender's card address and the screens' channel labels (apps/web/test/instagram-post.test.tsx). Each breaks one
// protection, and its named test must then fail.
import type { Case } from './case.ts';
import { mutate } from './sql.ts';

const HOOK = 'test/webhook-instagram.test.ts';
const POST = 'test/instagram-post.test.tsx';
const ROUTE = 'apps/web/app/api/webhooks/instagram/route.ts';
const INBOX = 'packages/core/src/inbox.ts';
const CARD_ROUTE = 'apps/web/app/api/cards/[tenant]/[file]/route.ts';
const CHANNELS = 'apps/web/lib/server/channels.ts';
const OUTBOX = 'apps/web/lib/server/outbox.ts';
const VIEWS = 'apps/web/components/app/OfficeViews.tsx';

const IGIN1 =
  "IGIN1 a signed direct message is stored once, as an ops row of the shop granted the account, under the grant's alias and the sender's scoped id; a redelivery, and a comment, store nothing more; no book row is written";
const IGIN2 =
  "IGIN2 an account no shop holds granted stores nothing, quietly: a withdrawn grant, an alias no grant names, another account's event and an account two shops hold each answer the same 200 with counts only; two holders log a coded warning naming no shop";
const IGIN3 = 'IGIN3 a STOP on Instagram is stored as a message like any other, with no opt-out (IG1)';
const IGIN4 =
  'IGIN4 a shop gone from the directory (a grant planted as one written before the purge revoked grants) does not block the shop granted the account now';
const IGIN5 =
  'IGIN5 a store that fails (the public pool unreachable) answers an empty 500, never a 200 for an event not stored, so Meta redelivers it';
const IGIN6 =
  'IGIN6 a shop pending acceptance that holds the account (a grant planted as one written before the acceptance rule) stores nothing and answers 200, so Meta does not redeliver';
const IGPOST4 =
  "IGPOST4 the outbox asks instagramCards() again before each sweep, as the screens do: a sender wired while a card address held is unwired once the store is gone, and the tick's rewire wires it again once it is back";
const IGCARD2 =
  "IGCARD2 the card route counts each caller's IP against the public API's read limit before any card is looked up: past it, an empty 429 with Retry-After and no store read; another IP is not limited";
const IGCARD1 =
  "IGCARD1 the card route serves a card only once its Instagram campaign is approved, as the bare JPEG whose sha256 is the document's own; composing, a WhatsApp campaign's, another shop's path, a malformed path, other bytes and no store are the one empty 404";
const IGPOST1 =
  "IGPOST1 an approved post goes through the outbox's claim to Meta with the card's public address under MUNSHI_APP_URL and the approved words exactly, and that address serves the card";
const IGPOST2 =
  "IGPOST2 without a card address (no media store, or an origin that is not https) no Instagram sender is wired: the approved post waits unposted, and the shop's channel state says no_card; with both it reads live";
const IGPOST3 =
  'IGPOST3 a post whose card the public may not fetch (erased after approval, or none named) reaches no Meta call: the sender is given no address the route would not serve, and the post fails';
const IGLABEL1 =
  'IGLABEL1 the inbox and campaigns screens say which channel sends for real and which is only recorded, in both languages; with none live, Recorded, nothing is sent; an Instagram message is labelled Instagram and offers no Draft reply or Draft order';

const web = (sabotage: string, file: string, test: string, source: string, from: string, to: string, sql?: string): Case => ({
  sabotage,
  dir: 'apps/web',
  file,
  test,
  config: 'vitest.config.ts',
  ts: { file: source, from, to },
  ...(sql ? { sql } : {}),
});

const IGHOOK_OFF = 'IGHOOK without Instagram configured every request is a 404, and no answer carries a token or a secret';

export const IG_CASES: Case[] = [
  // Meta's check answered where no event could be stored (no public pool): a subscription whose every POST is a 404
  web('v2-ig-hook-check-no-pool', HOOK, IGHOOK_OFF, ROUTE, 'const ig = c.publicDatabaseUrl ? c.instagram : undefined;', 'const ig = c.instagram;'),
  // the webhook stores under the account's numeric id, which no grant names (config refuses it as an alias)
  web('v2-ig-in-alias', HOOK, IGIN1, ROUTE, 'receiveInstagram(pool, ig.accountRef,', 'receiveInstagram(pool, ig.businessAccountId,'),
  // a redelivery inserted again: Meta's retry is a unique violation, a 500, and a redelivery storm
  web(
    'v2-ig-in-once',
    HOOK,
    IGIN1,
    INBOX,
    "values ($1, 'instagram', $2, $3, $4, $5, $6, false, now())\n       on conflict (tenant_id, provider_message_id)\n       do nothing returning id",
    "values ($1, 'instagram', $2, $3, $4, $5, $6, false, now())\n       returning id",
  ),
  // a purged shop's leftover grant counted: two holders, and every message to the shop holding the account dropped
  web('v2-ig-in-directory', HOOK, IGIN4, INBOX, ' and exists (select 1 from ops.tenant_directory d where d.tenant_id = g.tenant_id)', ''),
  // two holders dropped silently, with nothing in the log to say why
  web('v2-ig-in-silent-twice', HOOK, IGIN2, INBOX, "  if (held.length > 1) log('inbound.instagram_held_twice', { code: 'account_held_twice' }, 'warn');\n", ''),
  // a shop pending acceptance tried anyway: the database refuses (MS020), the webhook answers 500, and Meta redelivers forever
  web('v2-ig-in-pending', HOOK, IGIN6, INBOX, "    if (!(await c.query<{ open: boolean }>('select ops.inbound_open($1) as open', [tenantId])).rows[0]?.open) return null;\n", ''),
  // a failed store answered 200: Meta drops the event as handled, and it is lost
  web('v2-ig-hook-store-fail-200', HOOK, IGIN5, ROUTE, 'return new Response(null, { status: 500 });', 'return Response.json({ received: messages.length, stored });'),
  // a comment on the shop's post stored as if it were a direct message
  web('v2-ig-in-comment', HOOK, IGIN1, ROUTE, ' && x.source === "message"', ''),
  // another account's event (a misrouted subscription) stored under ours
  web('v2-ig-in-other-account', HOOK, IGIN2, ROUTE, 'x.accountId === ig.businessAccountId && ', ''),
  // an account two shops hold: stored for the first found, a guess
  web('v2-ig-in-twice', HOOK, IGIN2, INBOX, 'held.length === 1 ?', 'held.length >= 1 ?'),
  // the lookup's grant check and the database's both gone: a withdrawn grant's account is stored
  web(
    'v2-ig-in-ungranted',
    HOOK,
    IGIN2,
    INBOX,
    'where g.granted and g.account_ref = $1',
    'where g.account_ref = $1',
    mutate('ops.inbound_flow()', "if new.channel = 'instagram' and not coalesce(", 'if false and not coalesce('),
  ),
  // a STOP on Instagram taken as an opt-out: a message no one can then handle (handling needs a phone's withdrawal)
  web('v2-ig-in-stop', HOOK, IGIN3, INBOX, '$5, $6, false, now())', "$5, $6, upper($6) = 'STOP', now())"),
  // the card route serves whatever bytes the store holds under the key
  web('v2-ig-card-sha', POST, IGCARD1, CARD_ROUTE, ' || !createHash("sha256").update(bytes).digest().equals(card.sha256)', ''),
  // the card's address drops the shop: the route cannot find it under the public role's tenant context
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of channels.ts, not a template
  web('v2-ig-post-address', POST, IGPOST1, CHANNELS, '`${appUrl}/api/cards/${tenantId}/${documentId}.jpg`', '`${appUrl}/api/cards/${documentId}.jpg`'),
  // the screens and the wiring judge a card servable whatever the origin and the store
  web('v2-ig-cards-always', POST, IGPOST2, CHANNELS, '!!config().appUrl?.startsWith("https://") && mediaStore() !== null', 'true'),
  // the outbox wires Instagram's sender with no card address to give
  web('v2-ig-wire-no-card', POST, IGPOST2, OUTBOX, ' && jobs && cards) {', ' && jobs) {'),
  // the outbox wires once and never asks again: a store gone later still has the sender wired, and the post goes
  web('v2-ig-wire-once', POST, IGPOST4, OUTBOX, 'if (held.munshiOutboxWired?.cards === cards) return;', 'if (held.munshiOutboxWired) return;'),
  // the tick's check before its sweep does nothing: a store back since boot leaves the sender unwired
  web('v2-ig-tick-rewire', POST, IGPOST4, OUTBOX, '  if (held.munshiOutboxWired) wireOutbox();\n', ''),
  // the card route answers without counting the caller
  web(
    'v2-ig-card-rate',
    POST,
    IGCARD2,
    CARD_ROUTE,
    '  if (!hit.allowed) return new Response(null, { status: 429, headers: { ...NO_STORE, "retry-after": String(hit.retryAfter) } });\n',
    '',
  ),
  // the sender is given the address of a card the public may not fetch: Meta is called with a 404
  web('v2-ig-post-unservable', POST, IGPOST3, CHANNELS, 'if (!card || !(await publicCard(pub, tenantId, card))) return null;', 'if (!card) return null;'),
  // the screens say "sent" for the shop whatever each channel's state
  web('v2-ig-label-live', POST, IGLABEL1, VIEWS, '{ch.live ? (ch.channel === "instagram" ? a.instagramLive : a.inboxLive) :', '{true ? a.inboxLive :'),
  // an Instagram message labelled WhatsApp
  web('v2-ig-label-channel', POST, IGLABEL1, VIEWS, '{m.channel === "instagram" ? a.channelInstagram : a.channelWhatsapp}', '{a.channelWhatsapp}'),
  // Draft reply and Draft order offered on an Instagram DM, whose sender has no phone to answer on
  web('v2-ig-label-draft', POST, IGLABEL1, VIEWS, ' && m.channel !== "instagram"', ''),
];
