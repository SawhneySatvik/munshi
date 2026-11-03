// Channel adapters: one port, a sender per channel. Every deployment gets the recorded sender; WhatsApp Cloud and
// Instagram are switched on by channelsFor only where the deployment's send mode is live and their credentials are set
// (any deployment may hold them: real and sample shops share one database, so whether a shop is real is the tenant's
// class, not the deployment's). Even then the database decides each delivery's mode (`recorded` unless the shop holds a
// live grant and, on WhatsApp, the recipient is listed) and the outbox sweep hands a `pending` delivery to a real
// sender only for a real shop (data_class live), so a real adapter is reached only for a delivery of a real shop that
// the database made `pending`.

// The Graph API version every Meta call is made at. v26.0 is the current one (released 29 Jul 2026; v21.0, used before,
// expires 21 Jan 2027): developers.facebook.com/docs/graph-api/changelog/versions, read 3 Nov 2026.
export const GRAPH_VERSION = 'v26.0';

// Every call to Meta gives up after this long: the outbox sweep runs inside a database transaction.
export const META_TIMEOUT_MS = 10_000;

// A WhatsApp send outside the 24-hour window goes as an approved template, chosen by the message's purpose: a campaign,
// or one of customer.remind's templates.
export type TemplatePurpose = 'campaign' | 'credit_due' | 'package_expiring' | 'paypal_link';

// What a sender is handed for one delivery: the words to send and where, with ids. `to` is E.164 (NULL for a public
// post); `campaignId` and `accountRef` name a public post's campaign and the configured account its grant names.
// `window` is whether the person wrote within the last 24 hours; `purpose` names the template a send outside it may use.
export type Outbound = {
  deliveryId: string;
  tenantId: string;
  channel: 'whatsapp' | 'sms' | 'instagram';
  to: string | null;
  body: string;
  campaignId: string | null;
  accountRef: string | null;
  window: boolean;
  purpose: TemplatePurpose | null;
};

// What came back: the provider's message id, or only its numeric error code (never its text, which can carry the
// recipient's details). `unconfirmed`: no answer came after the request may have reached the provider (a timeout, a
// dropped connection), so it may have been sent: the outbox leaves such a delivery `sending`, never failed, never retried.
export type Sent = { ok: true; providerMessageId: string } | { ok: false; errorCode: string | null; unconfirmed?: true };
export type Sender = (m: Outbound) => Promise<Sent>;

// The senders a deploy has switched on: `recorded` always, the real ones only as channelsFor allows. `templates` holds,
// by purpose, the exact approved body of each WhatsApp template the deploy holds ({{1}} where the words go): a send
// outside the window waits (needs_window) unless its purpose has one and the words fit it (outbox.ts, templateFits).
export type Channels = {
  recorded: Sender;
  whatsapp?: Sender;
  instagram?: Sender;
  templates?: Readonly<Partial<Record<TemplatePurpose, string>>>;
};

export { type InboundInstagram, instagramGraph, parseInstagramWebhook } from './instagram.ts';
export { outboxDir, recordedSender } from './recorded.ts';
export { parseWhatsAppWebhook, verifyWhatsAppSignature, whatsAppCloud } from './whatsapp.ts';
// Meta signs every webhook (WhatsApp's and Instagram's) the same way: X-Hub-Signature-256 under the app secret.
export { verifyWhatsAppSignature as verifyMetaSignature } from './whatsapp.ts';

// The one switch: a deployment whose send mode is not live gets the recorded sender alone, whatever credentials it holds.
export function channelsFor(sendMode: string, recorded: Sender, live: Omit<Channels, 'recorded'> = {}): Channels {
  return sendMode === 'live' ? { recorded, ...live } : { recorded };
}
