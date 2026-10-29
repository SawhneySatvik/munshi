// CH1 end to end on a live deployment (BLUEPRINT §8.6, §8.7, review B1): a message reaches a real adapter only when the
// database made its delivery `pending`: a live shop, a real session, an operator's live grant and, on WhatsApp, a
// recipient the owner listed. Without the grant, every send is recorded; with it, the WhatsApp Cloud adapter is called
// once, shaped as Meta's API takes it; a closed 24-hour window holds the message (W5); a self-serve shop's approved
// post goes nowhere until the superadmin grants it Instagram and names the account. The adapters are the real ones
// over a fetch that answers as Meta would: no test touches the network.
//
// Each shop's owner acts through a real session: an ops.login_session row opened by core's startSession from the owner's
// live login (the first-owner login sign-up writes), so withTx sets `munshi.via = 'real'` as a signed-in request does.
// Red-proofs: test/v2/sabotage/core-messaging.ts.
import { createCampaign, createJobsPool, decide, proposeCampaign, runDueJobs, startSession, writeCopy } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { instagramGraph, whatsAppCloud } from '../../../../../packages/adapters/channels/index.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { asOwner, plant } from '../../gates/lib.ts';
import { sabotageIs } from '../../sabotage/index.ts';
import { jobsUrl } from '../jobs/lib.ts';
import { type Shop, smallShop } from '../shop.ts';
import { buys, consent, customer, grant, inbound, listed, type Outbox, wireRecorded } from './lib.ts';

let live: TestDb;
let app: pg.Pool;
let pub: pg.Pool;
let jobs: pg.Pool;
let a: Shop;
let b: Shop;
let outbox: Outbox;

// Meta's Graph API as a fetch: each call recorded, each answered as the docs show.
type Call = { url: string; body: Record<string, unknown>; auth: string | null };
const graph: Call[] = [];
const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  const call = { url: String(url), body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get('authorization') };
  graph.push(call);
  const answer = call.url.endsWith('/messages')
    ? { messaging_product: 'whatsapp', contacts: [{ input: call.body.to, wa_id: call.body.to }], messages: [{ id: `wamid.${graph.length}` }] }
    : call.url.endsWith('/media')
      ? { id: 'container-1' }
      : { id: 'ig-media-1' };
  return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

beforeAll(async () => {
  live = await openTestDb();
  await asOwner(live.admin, [`insert into ops.deployment (kind, hosted) values ('live', true)`]);
  app = live.as('munshi_app');
  pub = live.as('munshi_public');
  jobs = createJobsPool(jobsUrl(live), 4);
  a = await realShop('Live A');
  b = await realShop('Self-serve B');
  outbox = wireRecorded({
    whatsapp: whatsAppCloud({ phoneNumberId: '1000000001', token: 'test-token', graphVersion: 'v99.0', fetch: fakeFetch }),
    instagram: instagramGraph({
      accounts: { founder_pro: { igUserId: '17800000001', token: 'ig-token' } },
      mediaUrlFor: async (_tenant, campaign) => `https://shops.example/api/v1/media/${campaign}.jpg`,
      graphVersion: 'v99.0',
      fetch: fakeFetch,
    }),
  });
  await live.sabotage();
});
afterAll(async () => {
  outbox?.close();
  await jobs?.end();
  await live?.close();
});

// A small shop whose owner is signed in for real (only the owner has a login; the staff's sale needs no via).
async function realShop(label: string): Promise<Shop> {
  const shop = await smallShop(app, label);
  return { ...shop, owner: (await startSession(app, shop.owner.tenantId, shop.owner.memberId, 'real')).session };
}

let minute = 0;
const sweep = () => runDueJobs(jobs, new Date(Date.UTC(2031, 5, 1, 0, ++minute)), ['outbox']);
const regular = async (shop: Shop) => {
  const p = await customer(app, shop.owner);
  await buys(app, shop, p);
  await consent(app, shop.owner, p, true);
  return p;
};
async function approveCampaign(shop: Shop, channel: 'whatsapp' | 'instagram' = 'whatsapp'): Promise<string> {
  const campaign = await createCampaign(app, shop.owner, { name: 'Live campaign', channel, segment: 'bought_within_days', segmentDays: 30 });
  await writeCopy(app, { session: shop.owner }, campaign, 'Naya maal aa gaya hai, dekhne aaiye!');
  expect((await decide(app, shop.owner, await proposeCampaign(app, shop.owner, campaign), 'approved')).status).toBe('executed');
  return campaign;
}
const grantedShop = async (label: string) => {
  const shop = await realShop(label);
  await grant(live, shop.owner.tenantId, 'whatsapp');
  return shop;
};
const deliveries = async (campaign: string) =>
  (
    await live.admin.query<{ recipient_id: string; mode: string; status: string; provider_message_id: string | null }>(
      `select m.recipient_id, d.mode, d.status, d.provider_message_id from ops.delivery d join books.outbound_message m on m.tenant_id = d.tenant_id and m.id = d.message_id
        where m.campaign_id = $1 order by m.recipient_id`,
      [campaign],
    )
  ).rows;

it('CH1 on a live deploy from a real session, no grant means recorded: the WhatsApp adapter is never called; with the grant and a listed recipient it is called once', async () => {
  graph.length = 0;
  const p = await regular(a);
  const before = await approveCampaign(a);
  expect(await deliveries(before)).toEqual([{ recipient_id: p.customer, mode: 'recorded', status: 'queued', provider_message_id: null }]);
  await sweep();
  expect(graph).toEqual([]);
  expect((await deliveries(before))[0]).toMatchObject({ mode: 'recorded', status: 'sent' });

  // The superadmin grants WhatsApp; the owner lists the customer, who then writes to the shop (the window opens).
  await grant(live, a.owner.tenantId, 'whatsapp');
  await listed(app, a.owner, p);
  expect(await inbound(pub, p.phone.slice(1), 'Haan, bhejiye')).not.toBeNull();
  const after = await approveCampaign(a);
  expect((await deliveries(after))[0]).toMatchObject({ mode: 'pending', status: 'queued' });
  await sweep();
  expect(graph).toEqual([
    {
      url: 'https://graph.facebook.com/v99.0/1000000001/messages',
      auth: 'Bearer test-token',
      body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: p.phone.slice(1), type: 'text', text: { preview_url: false, body: 'Naya maal aa gaya hai, dekhne aaiye!' } },
    },
  ]);
  expect(await deliveries(after)).toEqual([{ recipient_id: p.customer, mode: 'cloud_api', status: 'sent', provider_message_id: 'wamid.1' }]);

  // An unlisted consenting customer of the same granted shop stays recorded.
  const unlisted = await regular(a);
  const third = await approveCampaign(a);
  const modes = Object.fromEntries((await deliveries(third)).map((d) => [d.recipient_id, d.mode]));
  expect([modes[p.customer], modes[unlisted.customer]]).toEqual(['pending', 'recorded']);
  await sweep();
  expect(graph).toHaveLength(2);
});

it('W5 a listed customer whose 24-hour window closed before the send is held as needs_window, unsent', async () => {
  graph.length = 0;
  const c = await grantedShop('Live W5');
  const p = await regular(c);
  await listed(app, c.owner, p);
  const msg = (await inbound(pub, p.phone.slice(1), 'Offer kab tak hai?')) as string;
  const campaign = await approveCampaign(c);
  expect(await deliveries(campaign)).toMatchObject([{ mode: 'pending', status: 'queued' }]);
  await plant(live.admin, `update ops.inbound_message set received_at = now() - interval '25 hours' where id = $1`, [msg]);
  await sweep();
  expect(await deliveries(campaign)).toMatchObject([{ mode: 'cloud_api', status: 'needs_window' }]);
  expect(graph).toEqual([]);
});

it('CH1 a grant withdrawn makes the next send recorded again, its recipients still listed', async () => {
  graph.length = 0;
  const d = await grantedShop('Live withdrawn');
  const p = await regular(d);
  await listed(app, d.owner, p);
  await inbound(pub, p.phone.slice(1), 'Haan ji');
  expect((await deliveries(await approveCampaign(d))).map((x) => x.mode)).toEqual(['pending']);
  await sweep();
  expect(graph).toHaveLength(1);
  graph.length = 0;
  await grant(live, d.owner.tenantId, 'whatsapp', false);
  const campaign = await approveCampaign(d);
  expect((await deliveries(campaign)).map((x) => x.mode)).toEqual(['recorded']);
  await sweep();
  expect(graph).toEqual([]);
});

it('CH1 a self-serve shop’s approved Instagram post goes nowhere: recorded; posted only once the superadmin grants Instagram and names the account', async () => {
  graph.length = 0;
  const post = await approveCampaign(b, 'instagram');
  await sweep();
  expect(graph).toEqual([]);
  expect(await deliveries(post)).toEqual([{ recipient_id: post, mode: 'recorded', status: 'sent', provider_message_id: `recorded:${(await live.admin.query('select d.id from ops.delivery d join books.outbound_message m on m.id = d.message_id where m.campaign_id = $1', [post])).rows[0]?.id}` }]);

  await grant(live, b.owner.tenantId, 'instagram', true, 'founder_pro');
  const granted = await approveCampaign(b, 'instagram');
  await sweep();
  expect(graph.map((c) => [c.url, c.auth, c.body])).toEqual([
    ['https://graph.facebook.com/v99.0/17800000001/media', 'Bearer ig-token', { image_url: `https://shops.example/api/v1/media/${granted}.jpg`, caption: 'Naya maal aa gaya hai, dekhne aaiye!' }],
    ['https://graph.facebook.com/v99.0/17800000001/media_publish', 'Bearer ig-token', { creation_id: 'container-1' }],
  ]);
  expect(await deliveries(granted)).toEqual([{ recipient_id: granted, mode: 'instagram', status: 'sent', provider_message_id: 'ig-media-1' }]);
});

// Every text, jsonb and bytea column of platform.* (as the superuser, past RLS), searched for a needle.
async function platformHolds(needle: string): Promise<string[]> {
  const { rows: cols } = await live.admin.query<{ rel: string; col: string; type: string }>(
    `select c.relname as rel, a.attname as col, format_type(a.atttypid, a.atttypmod) as type
       from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'platform' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
        and (a.atttypid in ('text'::regtype, 'jsonb'::regtype, 'bytea'::regtype) or format_type(a.atttypid, a.atttypmod) like 'character%')`,
  );
  expect(cols.length).toBeGreaterThan(5);
  const found: string[] = [];
  for (const { rel, col, type } of cols) {
    const expr = type === 'bytea' ? `position(convert_to($1, 'UTF8') in ${col}) > 0` : `strpos(${col}::text, $1) > 0`;
    const { rows } = await live.admin.query<{ n: number }>(`select count(*)::int as n from platform.${rel} where ${expr}`, [needle]);
    if ((rows[0]?.n ?? 0) > 0) found.push(`platform.${rel}.${col}`);
  }
  return found;
}

it('CH1 no listed recipient’s phone number is in any platform.* row, with or without its plus', async () => {
  const e = await grantedShop('Live scan');
  await listed(app, e.owner, await customer(app, e.owner));
  const { rows: phones } = await live.admin.query<{ phone: string }>(
    `select ct.phone_e164 as phone from ops.channel_recipient r join ops.contact ct on ct.tenant_id = r.tenant_id and ct.id = r.contact_id where ct.phone_e164 is not null`,
  );
  expect(phones.length).toBeGreaterThan(0);
  if (sabotageIs('v2-f3a-ch1-platform-scan')) {
    await plant(live.admin, `insert into platform.reserved_slug (slug, skeleton, note) values ('planted-slug', 'planted-slug', $1)`, [`call ${phones[0]?.phone.slice(1)}`]);
  }
  for (const { phone } of phones) {
    expect(await platformHolds(phone), phone).toEqual([]);
    expect(await platformHolds(phone.slice(1)), phone.slice(1)).toEqual([]);
  }
});
