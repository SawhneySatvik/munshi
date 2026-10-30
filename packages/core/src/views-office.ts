// The office screens of BP-APP-3 (apps/web/lib/server/office.ts shows them): the inbox (messages, and the order request
// a message quotes by its code, inbox.order_link), campaigns (each with its audience as a cell of campaign.audience and
// its copy's cited cells), settings (the capabilities with their switches and what each requires, the people and their
// live sessions, the shop's latest look) and the morning brief (ai.brief, its order a cell of brief.ranked). In the
// page's one transaction. The inbox is keyed by the messaging switch: on a shop with no channel grant (every demo shop)
// what it shows was recorded, and can('messaging') says whether sends are real.
import { briefLines, type BriefLine } from './brief.ts';
import { CAPABILITIES, type Capability, can, switchedOn } from './capabilities.ts';
import { copyRefs } from './commands-messaging.ts';
import type { CellRef } from './read.ts';
import type { Session } from './session.ts';
import { type Client, mint, read, type StoredSnapshot, storedSnapshots, type Viewer, viewer } from './views-common.ts';
import { type Shop, shopList } from './views-sell.ts';

const ORDER_CODE = /ORD-[A-Z0-9]{4,6}/i;
const INBOX_ROWS = 50;

export type InboxMessage = {
  id: string;
  channel: string;
  kind: string;
  text: string | null;
  status: string;
  receivedAt: string;
  optOut: boolean;
  link: StoredSnapshot | null; // inbox.order_link, for a message that quotes an order code
};
export type InboxView = { viewer: Viewer; granted: boolean; messages: InboxMessage[] };

export async function viewInbox(c: Client, session: Session): Promise<InboxView | null> {
  if (!(await switchedOn(c, 'messaging'))) return null;
  const granted = await can(c, session, 'messaging');
  const me = await viewer(c, session);
  const rows = await read<{ id: string; channel: string; kind: string; text: string | null; status: string; received_at: Date; opt_out: boolean }>(
    c,
    `select id::text, channel, kind, coalesce(transcript, text) as text, status, received_at, opt_out from ops.inbound_message
      where erased_at is null order by received_at desc, id desc limit ${INBOX_ROWS}`,
  );
  const messages: InboxMessage[] = [];
  for (const m of rows) {
    messages.push({
      id: m.id,
      channel: m.channel,
      kind: m.kind,
      text: m.text,
      status: m.status,
      receivedAt: m.received_at.toISOString(),
      optOut: m.opt_out,
      link: m.text && ORDER_CODE.test(m.text) ? await mint(c, 'inbox.order_link', { message_id: m.id }) : null,
    });
  }
  return { viewer: me, granted, messages };
}

export type Campaign = {
  id: string;
  name: string;
  channel: string;
  segment: string;
  status: string;
  offer: string | null;
  body: string | null;
  audience: StoredSnapshot | null; // campaign.audience, read now while it is composing
  draftId: string | null;
  draftStatus: string | null;
  cited: CellRef[]; // what its latest draft cites: the audience's row count first, then the copy's figures
  createdAt: string;
};
export type CampaignsView = { viewer: Viewer; granted: boolean; campaigns: Campaign[]; offers: { id: string; name: string }[]; cited: StoredSnapshot[] };

export async function viewCampaigns(c: Client, session: Session): Promise<CampaignsView | null> {
  if (!(await can(c, session, 'campaigns'))) return null;
  const granted = await can(c, session, 'messaging');
  const me = await viewer(c, session);
  const rows = await read<{
    id: string;
    name: string;
    channel: string;
    segment: string;
    status: string;
    offer: string | null;
    body: string | null;
    draft_id: string | null;
    draft_status: string | null;
    draft_on: CellRef[] | null;
    created_at: Date;
  }>(
    c,
    `select k.id::text, k.name, k.channel, k.segment, k.status, o.name as offer, t.body, k.created_at,
            d.id::text as draft_id, d.status as draft_status, d.based_on as draft_on
       from ops.campaign k
       left join books.offer o on o.tenant_id = k.tenant_id and o.id = k.offer_id
       left join ops.message_text t on t.tenant_id = k.tenant_id and t.id = k.copy_text_id and t.erased_at is null
       left join lateral (select x.id, x.status, x.based_on from approval.draft x
                           where x.command in ('campaign.send', 'campaign.post') and x.payload->>'campaignId' = k.id::text
                           order by x.created_at desc limit 1) d on true
      order by k.created_at desc, k.id desc limit 30`,
  );
  const campaigns: Campaign[] = [];
  for (const k of rows) {
    campaigns.push({
      id: k.id,
      name: k.name,
      channel: k.channel,
      segment: k.segment,
      status: k.status,
      offer: k.offer,
      body: k.body,
      audience: k.status === 'composing' ? await mint(c, 'campaign.audience', { campaign_id: k.id }) : null,
      draftId: k.draft_id,
      draftStatus: k.draft_status,
      cited: k.draft_on ?? [],
      createdAt: k.created_at.toISOString(),
    });
  }
  // A proposed campaign's audience is the one its draft cites; a copy's figures are the cells it cites.
  const cited = await storedSnapshots(c, [
    ...campaigns.flatMap((k) => k.cited.map((r) => r.snapshotId)),
    ...campaigns.flatMap((k) => (k.body ? copyRefs(k.body).map((r) => r.snapshotId) : [])),
  ]);
  const offers = await read<{ id: string; name: string }>(
    c,
    `select o.id::text, o.name from books.offer o where o.ends_at > now()
        and not exists (select 1 from books.offer_end e where e.tenant_id = o.tenant_id and e.offer_id = o.id and e.ended_at <= now())
      order by o.name, o.id`,
  );
  return { viewer: me, granted, campaigns, offers, cited };
}

export type CapabilityRow = { code: Capability; on: boolean; usable: boolean; needsGrant: boolean; requires: string[]; requiredBy: string[] };
export type SettingsView = {
  viewer: Viewer;
  capabilities: CapabilityRow[];
  members: { id: string; name: string; role: string; active: boolean }[];
  sessions: { id: string; member: string; via: string; createdAt: string; expiresAt: string; mine: boolean }[];
  look: { tokens: Record<string, string>; fontPair: string; createdAt: string } | null;
  shops: Shop[];
};

/** The owner's settings: every capability with its switch and requirements, the people and live sessions, the look. */
export async function viewSettings(c: Client, session: Session): Promise<SettingsView | null> {
  const me = await viewer(c, session);
  if (me.member.role !== 'owner') return null;
  const requires = await read<{ capability: string; requires: string }>(c, 'select capability, requires from ref.capability_requires order by 1, 2');
  const grants = await read<{ code: string; needs_grant: boolean }>(c, 'select code, needs_grant from ref.capability');
  const capabilities: CapabilityRow[] = [];
  for (const code of CAPABILITIES) {
    capabilities.push({
      code,
      on: await switchedOn(c, code),
      usable: await can(c, session, code),
      needsGrant: grants.find((g) => g.code === code)?.needs_grant ?? false,
      requires: requires.filter((r) => r.capability === code).map((r) => r.requires),
      requiredBy: requires.filter((r) => r.requires === code).map((r) => r.capability),
    });
  }
  const members = await read<{ id: string; name: string; role: string; active: boolean }>(
    c,
    `select id::text, coalesce(display_name, '') as name, role, active from ops.member where erased_at is null order by active desc, role, display_name, id`,
  );
  const sessions = await read<{ id: string; member: string; via: string; created_at: Date; expires_at: Date }>(
    c,
    `select s.id::text, coalesce(m.display_name, '') as member, s.via, s.created_at, s.expires_at
       from ops.login_session s join ops.member m on m.tenant_id = s.tenant_id and m.id = s.member_id
      where s.revoked_at is null and s.expires_at > now() order by s.created_at desc limit 50`,
  );
  const [look] = await read<{ tokens: Record<string, string>; font_pair: string; created_at: Date }>(
    c,
    'select tokens, font_pair, created_at from ops.site_look order by created_at desc, id desc limit 1',
  );
  return {
    viewer: me,
    capabilities,
    members: members.map((m) => ({ id: m.id, name: m.name, role: m.role, active: m.active })),
    sessions: sessions.map((s) => ({
      id: s.id,
      member: s.member,
      via: s.via,
      createdAt: s.created_at.toISOString(),
      expiresAt: s.expires_at.toISOString(),
      mine: s.id === session.sessionId,
    })),
    look: look ? { tokens: look.tokens, fontPair: look.font_pair, createdAt: look.created_at.toISOString() } : null,
    shops: await shopList(c),
  };
}

export type BriefView = {
  viewer: Viewer;
  briefs: { id: string; shop: string; day: string; createdAt: string; lines: BriefLine[] }[];
  snapshots: StoredSnapshot[];
};

/** Each branch's latest morning brief: its lines in the order brief.ranked's rank cells give, and every cell they cite. */
export async function viewBrief(c: Client, session: Session): Promise<BriefView> {
  const me = await viewer(c, session);
  const rows = await read<{ id: string; shop: string; day: string; created_at: Date }>(
    c,
    `select distinct on (b.shop_id) b.id::text, s.name as shop, b.business_date::text as day, b.created_at
       from ai.brief b join ops.shop s on s.tenant_id = b.tenant_id and s.id = b.shop_id
      order by b.shop_id, b.business_date desc, b.created_at desc`,
  );
  const briefs: BriefView['briefs'] = [];
  for (const b of rows) briefs.push({ id: b.id, shop: b.shop, day: b.day, createdAt: b.created_at.toISOString(), lines: await briefLines(c, b.id) });
  const ids = briefs.flatMap((b) => b.lines.flatMap((l) => [l.rank.snapshotId, ...l.refs.map((r) => r.snapshotId)]));
  return { viewer: me, briefs, snapshots: await storedSnapshots(c, ids) };
}
