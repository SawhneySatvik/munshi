// Instagram content publishing (Meta's public docs, developers.facebook.com/docs/instagram-platform/content-publishing):
// a container from a public JPEG URL and the caption, then its publish. Switched on only on a live deploy, and only for
// the configured account a shop's Instagram grant names (account_ref, review B1); an unknown account posts nothing.
// The card's public URL is the deploy's to give (mediaUrlFor): the sender knows the campaign, not where its card is
// served. The Graph host and version for a tester account in development mode are UNVERIFIED (study A).
import type { Sender } from './index.ts';
import { numericCode } from './whatsapp.ts';

type Fetch = typeof globalThis.fetch;
type Config = {
  accounts: Readonly<Record<string, { igUserId: string; token: string }>>;
  mediaUrlFor: (tenantId: string, campaignId: string) => Promise<string | null>;
  graphVersion: string;
  fetch: Fetch;
};

export function instagramGraph(cfg: Config): Sender {
  return async (m) => {
    const account = m.accountRef && Object.hasOwn(cfg.accounts, m.accountRef) ? cfg.accounts[m.accountRef] : undefined;
    if (m.channel !== 'instagram' || !account || !m.campaignId) return { ok: false, errorCode: null };
    const imageUrl = await cfg.mediaUrlFor(m.tenantId, m.campaignId);
    if (!imageUrl) return { ok: false, errorCode: null };
    const post = async (edge: string, body: Record<string, string>) => {
      const res = await cfg.fetch(`https://graph.facebook.com/${cfg.graphVersion}/${account.igUserId}/${edge}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${account.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return (await res.json()) as { id?: unknown; error?: { code?: unknown } };
    };
    try {
      const container = await post('media', { image_url: imageUrl, caption: m.body });
      if (typeof container.id !== 'string' || container.error) return { ok: false, errorCode: numericCode(container.error?.code) };
      const media = await post('media_publish', { creation_id: container.id });
      if (typeof media.id !== 'string' || media.id.length > 128 || media.error) return { ok: false, errorCode: numericCode(media.error?.code) };
      return { ok: true, providerMessageId: media.id };
    } catch {
      return { ok: false, errorCode: null };
    }
  };
}
