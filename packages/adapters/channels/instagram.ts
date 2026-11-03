// Instagram content publishing and its webhook (Meta's public docs, read 3 Nov 2026):
// - developers.facebook.com/docs/instagram-platform/content-publishing: POST /<IG_ID>/media with `image_url` (and the
//   caption) makes a container; POST /<IG_ID>/media_publish with `creation_id` publishes it and answers the media id.
//   The host follows the login the token came from: graph.instagram.com for an Instagram user token (Instagram Login),
//   graph.facebook.com for a Page or system-user token (Facebook Login, Unified Login). JPEG is the only image format;
//   Meta fetches the image from the URL, so it must be on a public server (HTTPS here); an account may publish 100 posts
//   in a moving 24 hours. The container status check (GET /<container>?fields=status_code) is documented for video, so
//   an image container is published at once.
// - developers.facebook.com/documentation/instagram-platform/webhooks/{setup,examples}: `object: instagram`; a message
//   under entry[].messaging[] (sender.id, the person's Instagram-scoped id; message.mid, .text, .attachments, and
//   is_echo, is_self, is_deleted); a comment under entry[].changes[] with field `comments` (value.id or comment_id,
//   from.id, text, media.id). Signed as every Meta webhook is (X-Hub-Signature-256, verifyMetaSignature).
// Switched on only by channelsFor, and only for the configured account a shop's Instagram grant names (account_ref); an
// unknown account posts nothing. The card's public URL is the deploy's to give (mediaUrlFor): the sender knows the
// campaign, not where its card is served.
import { META_TIMEOUT_MS, type Sender } from './index.ts';
import { numericCode } from './whatsapp.ts';

type Fetch = typeof globalThis.fetch;
type Config = {
  accounts: Readonly<Record<string, { igUserId: string; token: string }>>;
  mediaUrlFor: (tenantId: string, campaignId: string) => Promise<string | null>;
  graphVersion: string;
  host: 'graph.instagram.com' | 'graph.facebook.com';
  fetch: Fetch;
  timeoutMs?: number;
};

export function instagramGraph(cfg: Config): Sender {
  return async (m) => {
    const account = m.accountRef && Object.hasOwn(cfg.accounts, m.accountRef) ? cfg.accounts[m.accountRef] : undefined;
    if (m.channel !== 'instagram' || !account || !m.campaignId) return { ok: false, errorCode: null };
    const imageUrl = await cfg.mediaUrlFor(m.tenantId, m.campaignId);
    if (!imageUrl?.startsWith('https://')) return { ok: false, errorCode: null };
    const post = async (edge: string, body: Record<string, string>) => {
      const res = await cfg.fetch(`https://${cfg.host}/${cfg.graphVersion}/${account.igUserId}/${edge}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${account.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? META_TIMEOUT_MS),
      });
      return (await res.json()) as { id?: unknown; error?: { code?: unknown } };
    };
    // A container alone publishes nothing, so a failed container call is a plain failure; a publish with no answer may
    // have posted, so it is unconfirmed.
    let container: { id?: unknown; error?: { code?: unknown } };
    try {
      container = await post('media', { image_url: imageUrl, caption: m.body });
    } catch {
      return { ok: false, errorCode: null };
    }
    if (typeof container.id !== 'string' || container.error) return { ok: false, errorCode: numericCode(container.error?.code) };
    try {
      const media = await post('media_publish', { creation_id: container.id });
      if (typeof media.id !== 'string' || media.id.length > 128 || media.error) return { ok: false, errorCode: numericCode(media.error?.code) };
      return { ok: true, providerMessageId: media.id };
    } catch {
      return { ok: false, errorCode: null, unconfirmed: true };
    }
  };
}

// One thing a person sent the shop's Instagram account: a direct message or a comment on its media. `from` is the
// person's Instagram-scoped id (digits), never a username, which is dropped here as WhatsApp's profile name is.
export type InboundInstagram = {
  accountId: string;
  source: 'message' | 'comment';
  providerMessageId: string;
  from: string;
  kind: 'text' | 'audio' | 'image' | 'other';
  text: string | null;
};

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length >= 1 && v.length <= max ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const igsid = (v: unknown): string | null => {
  const s = str(v, 32);
  return s && /^[0-9]{1,32}$/.test(s) ? s : null;
};

// The webhook's messages and comments, entry by entry. The shop's own messages (an echo, a test to itself, anything
// sent by the account) and deleted ones are skipped; anything malformed is skipped, never guessed. Meta's examples show
// the body inside an array, so an array of bodies is read too.
export function parseInstagramWebhook(payload: unknown): InboundInstagram[] {
  const found: InboundInstagram[] = [];
  for (const body of Array.isArray(payload) ? payload : [payload]) {
    if (obj(body).object !== 'instagram') continue;
    for (const entry of list(obj(body).entry)) {
      const accountId = igsid(obj(entry).id);
      if (!accountId) continue;
      for (const raw of list(obj(entry).messaging)) {
        const e = obj(raw);
        const m = obj(e.message);
        const [providerMessageId, from] = [str(m.mid, 128), igsid(obj(e.sender).id)];
        if (!providerMessageId || !from || from === accountId || m.is_echo === true || m.is_self === true || m.is_deleted === true) continue;
        const first = obj(list(m.attachments)[0]).type;
        const text = str(m.text, 4096);
        const kind = text ? 'text' : first === 'image' ? 'image' : first === 'audio' ? 'audio' : 'other';
        found.push({ accountId, source: 'message', providerMessageId, from, kind, text });
      }
      for (const raw of list(obj(entry).changes)) {
        const change = obj(raw);
        if (change.field !== 'comments') continue;
        const v = obj(change.value);
        const [providerMessageId, from, text] = [str(v.id, 128) ?? str(v.comment_id, 128), igsid(obj(v.from).id), str(v.text, 4096)];
        if (!providerMessageId || !from || from === accountId) continue;
        found.push({ accountId, source: 'comment', providerMessageId, from, kind: text ? 'text' : 'other', text });
      }
    }
  }
  return found;
}
