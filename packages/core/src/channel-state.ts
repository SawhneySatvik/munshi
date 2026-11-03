// Whether each channel of a shop sends for real, and if not, why: one rule for the console's grant page and the shop's
// settings, so neither screen can say "live" where the send is recorded. It mirrors the layers a real send passes,
// first failing first: a real shop (data_class live; on today's schema a live class exists only on a live deployment,
// so it stands for ops.delivery_derive's deployment check too), the deployment's send mode (MUNSHI_SEND_MODE,
// channelsFor), the channel's credentials, the operator's grant, and for Instagram the grant naming the configured
// account and a public HTTPS address for a post's card (without one the deploy wires no Instagram sender). WhatsApp is
// then live only to the recipients the owner listed; everyone else's messages stay recorded, so its live state says so.
import type pg from 'pg';

export type Channel = 'whatsapp' | 'instagram';
export type ChannelReason = 'live_listed' | 'live' | 'sample_shop' | 'send_mode' | 'no_credential' | 'no_grant' | 'no_account' | 'no_card';
export type ChannelState = { channel: Channel; live: boolean; reason: ChannelReason };
/** What the deployment holds, as booleans and the Instagram account ref (INSTAGRAM_ACCOUNT_REF, the name a grant uses)
 *  only: never a token, a secret or an id. `instagramCard`: the deploy can give a post's card a public HTTPS address,
 *  which Instagram fetches the image from. */
export type ChannelDeploy = { sendMode: 'recorded' | 'live'; whatsapp: boolean; instagramAccount: string | null; instagramCard: boolean };

/** The deploy's channel facts from its settings (@munshi/config's webConfig or channelSettings). */
export function channelDeployOf(
  s: { sendMode?: 'recorded' | 'live' | undefined; whatsapp?: unknown; instagram?: { accountRef: string } | undefined },
  instagramCard: boolean,
): ChannelDeploy {
  return { sendMode: s.sendMode ?? 'recorded', whatsapp: !!s.whatsapp, instagramAccount: s.instagram?.accountRef ?? null, instagramCard };
}
export type ChannelGrant = { granted: boolean; accountRef: string | null } | null;

export function channelState(channel: Channel, dataClass: string, grant: ChannelGrant, deploy: ChannelDeploy): ChannelState {
  const recorded = (reason: ChannelReason): ChannelState => ({ channel, live: false, reason });
  if (dataClass !== 'live') return recorded('sample_shop');
  if (deploy.sendMode !== 'live') return recorded('send_mode');
  if (channel === 'whatsapp' ? !deploy.whatsapp : !deploy.instagramAccount) return recorded('no_credential');
  if (!grant?.granted) return recorded('no_grant');
  if (channel === 'instagram' && grant.accountRef !== deploy.instagramAccount) return recorded('no_account');
  if (channel === 'instagram' && !deploy.instagramCard) return recorded('no_card');
  return { channel, live: true, reason: channel === 'whatsapp' ? 'live_listed' : 'live' };
}

/** The shop's two channels, read in the caller's transaction under the shop's context (munshi_app or munshi_jobs). */
export async function channelStates(c: pg.ClientBase, tenantId: string, deploy: ChannelDeploy): Promise<ChannelState[]> {
  const { rows } = await c.query<{ data_class: string | null; grants: { channel: Channel; granted: boolean; account_ref: string | null }[] }>(
    `select (select data_class from ops.tenant where tenant_id = $1) as data_class,
            coalesce((select jsonb_agg(g) from (select distinct on (channel) channel, granted, account_ref from platform.channel_grant
                                                  where tenant_id = $1 order by channel, effective_from desc, id desc) g), '[]') as grants`,
    [tenantId],
  );
  const r = rows[0];
  return (['whatsapp', 'instagram'] as const).map((channel) => {
    const g = r?.grants.find((x) => x.channel === channel);
    return channelState(channel, r?.data_class ?? '', g ? { granted: g.granted, accountRef: g.account_ref } : null, deploy);
  });
}
