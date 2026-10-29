// Channel adapters (BLUEPRINT §1.2, §8.6): one port, a sender per channel. The recorded sender is the only one a demo,
// a sandbox or a test deploy ever gets; WhatsApp Cloud and Instagram are switched on only by channelsFor on a live
// deploy, and even there the database decides each delivery's mode (`recorded` unless the shop holds a live grant and
// the recipient is listed, CH1), so a real adapter is reached only for a delivery the database made `pending`.

// What a sender is handed for one delivery: the words to send and where, with ids. `to` is E.164 (NULL for a public
// post); `campaignId` and `accountRef` name a public post's campaign and the configured account its grant names.
export type Outbound = {
  deliveryId: string;
  tenantId: string;
  channel: 'whatsapp' | 'sms' | 'instagram';
  to: string | null;
  body: string;
  campaignId: string | null;
  accountRef: string | null;
};

// What came back: the provider's message id, or only its numeric error code (never its text, which can carry the
// recipient's details). A network failure has no code.
export type Sent = { ok: true; providerMessageId: string } | { ok: false; errorCode: string | null };
export type Sender = (m: Outbound) => Promise<Sent>;

// The senders a deploy has switched on: `recorded` always, the real ones only on a live deploy.
export type Channels = { recorded: Sender; whatsapp?: Sender; instagram?: Sender };

export { instagramGraph } from './instagram.ts';
export { outboxDir, recordedSender } from './recorded.ts';
export { parseWhatsAppWebhook, verifyWhatsAppSignature, whatsAppCloud } from './whatsapp.ts';

// The one switch: a deployment that is not live gets the recorded sender alone, whatever credentials it was handed.
export function channelsFor(deployment: string, recorded: Sender, live: { whatsapp?: Sender; instagram?: Sender } = {}): Channels {
  return deployment === 'live' ? { recorded, ...live } : { recorded };
}
