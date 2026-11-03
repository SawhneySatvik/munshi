// WhatsApp Cloud API (Meta's public docs, read 3 Nov 2026): a message to one user, the webhook's signature and its
// payload. Switched on only by channelsFor. fetch is passed in, so no test touches the network; every call has a timeout.
// - A free-form text goes only inside the customer service window, the 24 hours after the person last wrote
//   (developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages).
// - Outside it only an approved template goes (same page; templates/overview: `type: template`, `template.name`,
//   `template.language.code`, `components: [{ type: body, parameters: [{ type: text, text }] }]`, positional {{1}}).
//   The body text of a template is at most 1024 characters (templates/components). The words go unchanged: the outbox
//   sends a template only when they fit it (outbox.ts, templateFits), else the send waits for the person to write.
// - A request with no answer (a timeout, a dropped connection) may have reached Meta: it is `unconfirmed`, never failed.
// - `to` is sent as digits without the plus, as the send-messages example does (the template example shows a plus;
//   UNVERIFIED that both are taken, so the plus is dropped as before).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { META_TIMEOUT_MS, type Outbound, type Sender, type TemplatePurpose } from './index.ts';

type Fetch = typeof globalThis.fetch;
type Config = {
  phoneNumberId: string;
  token: string;
  graphVersion: string;
  fetch: Fetch;
  /** Approved template names by purpose, and their language code; a purpose with none never sends outside the window. */
  templates?: Partial<Record<TemplatePurpose, string>>;
  language?: string;
  timeoutMs?: number;
};

export const numericCode = (v: unknown): string | null =>
  (typeof v === 'number' || typeof v === 'string') && /^[0-9]{1,8}$/.test(String(v)) ? String(v) : null;

// The message itself: a text inside the window, else the purpose's template carrying the words as its one parameter.
function content(cfg: Config, m: Outbound): Record<string, unknown> | null {
  if (m.window) return { type: 'text', text: { preview_url: false, body: m.body } };
  const name = m.purpose ? cfg.templates?.[m.purpose] : undefined;
  if (!name) return null;
  return {
    type: 'template',
    template: { name, language: { code: cfg.language ?? 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: m.body }] }] },
  };
}

// POST /{version}/{phone-number-id}/messages. The answer's messages[0].id (a wamid) is the provider id the webhook's
// statuses later name; an error answer keeps only error.code (131047: the 24-hour window closed; 131049: the per-user
// marketing cap).
export function whatsAppCloud(cfg: Config): Sender {
  return async (m) => {
    const message = m.channel === 'whatsapp' && m.to ? content(cfg, m) : null;
    if (!message || !m.to) return { ok: false, errorCode: null };
    let answer: { messages?: { id?: unknown }[]; error?: { code?: unknown } } | undefined;
    try {
      const res = await cfg.fetch(`https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: m.to.replace(/^\+/, ''), ...message }),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? META_TIMEOUT_MS),
      });
      answer = (await res.json()) as typeof answer;
    } catch {
      return { ok: false, errorCode: null, unconfirmed: true };
    }
    const id = answer?.messages?.[0]?.id;
    if (typeof id === 'string' && id.length >= 1 && id.length <= 128 && !answer?.error) return { ok: true, providerMessageId: id };
    return { ok: false, errorCode: numericCode(answer?.error?.code) };
  };
}

// X-Hub-Signature-256 is `sha256=` and the hex HMAC-SHA256 of the raw body under the app secret. Compared in constant
// time over equal-length digests, before anything parses the body; a missing or malformed header is false.
export function verifyWhatsAppSignature(rawBody: string | Buffer, header: string | null | undefined, appSecret: string): boolean {
  if (!appSecret || typeof header !== 'string' || !/^sha256=[0-9a-f]{64}$/.test(header)) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(header.slice('sha256='.length), 'hex'));
}

export type InboundWhatsApp = {
  phoneNumberId: string;
  providerMessageId: string;
  from: string; // as Meta sends it: digits, no plus
  kind: 'text' | 'audio' | 'image' | 'other';
  text: string | null;
  mediaId: string | null;
};
export type StatusWhatsApp = {
  phoneNumberId: string;
  providerMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  recipient: string;
  errorCode: string | null;
};

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length >= 1 && v.length <= max ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// The webhook's `messages` and `statuses`, entry by entry. A sender's profile name is dropped here: the shop never needs
// it. Anything malformed is skipped, never guessed.
export function parseWhatsAppWebhook(payload: unknown): { messages: InboundWhatsApp[]; statuses: StatusWhatsApp[] } {
  const messages: InboundWhatsApp[] = [];
  const statuses: StatusWhatsApp[] = [];
  if (obj(payload).object !== 'whatsapp_business_account') return { messages, statuses };
  for (const entry of list(obj(payload).entry)) {
    for (const change of list(obj(entry).changes)) {
      if (obj(change).field !== 'messages') continue;
      const value = obj(obj(change).value);
      const phoneNumberId = str(obj(value.metadata).phone_number_id, 64);
      if (!phoneNumberId) continue;
      for (const raw of list(value.messages)) {
        const m = obj(raw);
        const [providerMessageId, from] = [str(m.id, 128), str(m.from, 32)];
        if (!providerMessageId || !from) continue;
        const kind = m.type === 'text' || m.type === 'audio' || m.type === 'image' ? m.type : 'other';
        const text = kind === 'text' ? str(obj(m.text).body, 4096) : kind === 'image' ? str(obj(m.image).caption, 4096) : null;
        const mediaId = kind === 'audio' ? str(obj(m.audio).id, 128) : kind === 'image' ? str(obj(m.image).id, 128) : null;
        messages.push({ phoneNumberId, providerMessageId, from, kind, text, mediaId });
      }
      for (const raw of list(value.statuses)) {
        const s = obj(raw);
        const [providerMessageId, recipient] = [str(s.id, 128), str(s.recipient_id, 32)];
        const status = s.status === 'sent' || s.status === 'delivered' || s.status === 'read' || s.status === 'failed' ? s.status : null;
        if (!providerMessageId || !recipient || !status) continue;
        statuses.push({ phoneNumberId, providerMessageId, status, recipient, errorCode: numericCode(obj(list(s.errors)[0]).code) });
      }
    }
  }
  return { messages, statuses };
}
