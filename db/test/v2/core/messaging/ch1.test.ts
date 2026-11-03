// CH1 end to end on a live deployment (BLUEPRINT §8.6, §8.7, review B1): a message reaches a real adapter only when the
// database made its delivery `pending`: a live shop, a real session, an operator's live grant and, on WhatsApp, a
// recipient the owner listed. Without the grant, every send is recorded; with it, the WhatsApp Cloud adapter is called
// once, shaped as Meta's API takes it; a closed 24-hour window holds the message (W5); a self-serve shop's approved
// post goes nowhere until the superadmin grants it Instagram and names the account. The adapters are the real ones
// over a fetch that answers as Meta would: no test touches the network.
//
// Each shop's owner acts through a real session: an ops.login_session row opened by core's startSession from the owner's
// live login (the first-owner login sign-up writes), so withTx sets `munshi.via = 'real'` as a signed-in request does.
// LIVE1-6 (platform design §5, D-080): nothing is sent before approval; a sample shop never sends for real, whatever
// grant or credential; a channel without its credential or on a recorded send mode reaches no adapter, and its state
// says why; one approved post is posted once however many sweeps run; no token reaches a log line or a row; and a
// campaign outside the 24-hour window goes as the deploy's approved template.
// Red-proofs: test/v2/sabotage/core-messaging.ts and live-channels.ts.
import {
  approveChange,
  type ChannelDeploy,
  channelDeployOf,
  channelStates,
  changeDiff,
  createCampaign,
  createJobsPool,
  decide,
  proposeCampaign,
  proposeChange,
  runCommand,
  runDueJobs,
  startSession,
  switchCapability,
  withOperator,
  withTx,
  writeCopy,
} from '@munshi/core';
import { channelSettings } from '../../../../../packages/config/src/index.ts';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { type Channels, channelsFor, instagramGraph, type Sender, whatsAppCloud } from '../../../../../packages/adapters/channels/index.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { codeOf, firstOperator, SECRETS, signIn } from '../platform/fixture.ts';
import { asOwner, plant } from '../../gates/lib.ts';
import { sabotageIs } from '../../sabotage/index.ts';
import { jobsUrl } from '../jobs/lib.ts';
import { type Shop, smallShop } from '../shop.ts';
import { buys, consent, customer, grant, inbound, listed, type Outbox, raceForClaim, wireRecorded } from './lib.ts';

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

// The real adapters over the fake Graph API, wired as a live send mode with both credentials wires them.
const LIVE: Omit<Channels, 'recorded'> = {
  whatsapp: whatsAppCloud({ phoneNumberId: '1000000001', token: 'test-token', graphVersion: 'v99.0', fetch: fakeFetch }),
  instagram: instagramGraph({
    accounts: { founder_pro: { igUserId: '17800000001', token: 'ig-token' } },
    mediaUrlFor: async (_tenant, campaign) => `https://shops.example/api/v1/media/${campaign}.jpg`,
    graphVersion: 'v99.0',
    host: 'graph.facebook.com',
    fetch: fakeFetch,
  }),
};

beforeAll(async () => {
  live = await openTestDb();
  await asOwner(live.admin, [`insert into ops.deployment (kind, hosted) values ('live', true)`]);
  app = live.as('munshi_app');
  pub = live.as('munshi_public');
  jobs = createJobsPool(jobsUrl(live), 4);
  a = await realShop('Live A');
  b = await realShop('Self-serve B');
  outbox = wireRecorded(LIVE);
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
  await switchCapability(app, shop.owner, 'campaigns', true); // a kirana's pack has messaging, not campaigns
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
const deliveryIdOf = async (campaign: string) =>
  (await live.admin.query<{ id: string }>('select d.id from ops.delivery d join books.outbound_message m on m.id = d.message_id where m.campaign_id = $1', [campaign]))
    .rows[0]?.id as string;
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

// ---- LIVE1-10 --------------------------------------------------------------------------------------------------------

const DEPLOY: ChannelDeploy = { sendMode: 'live', whatsapp: true, instagramAccount: 'founder_pro', instagramCard: true };
const statesOf = (shop: Shop, deploy = DEPLOY) => withTx(app, { kind: 'member', session: shop.owner }, (c) => channelStates(c, shop.owner.tenantId, deploy));
const draftPayload = async (draft: string) =>
  (await live.admin.query<{ payload: Record<string, unknown> }>('select payload from approval.draft where id = $1', [draft])).rows[0]?.payload;
const instagramShop = async (label: string) => {
  const shop = await realShop(label);
  await grant(live, shop.owner.tenantId, 'instagram', true, 'founder_pro');
  return shop;
};

it('LIVE1 nothing is sent before approval: a proposed post has no delivery and reaches no adapter, the command run directly is refused; the approval posts it once', async () => {
  graph.length = 0;
  const shop = await instagramShop('Live before approval');
  const campaign = await createCampaign(app, shop.owner, { name: 'Before approval', channel: 'instagram', segment: 'bought_within_days', segmentDays: 30 });
  await writeCopy(app, { session: shop.owner }, campaign, 'Naya maal aa gaya hai, dekhne aaiye!');
  const draft = await proposeCampaign(app, shop.owner, campaign);
  await sweep();
  expect(await deliveries(campaign)).toEqual([]);
  // The draft's own payload, run as the owner's direct command: refused, since it runs only as an approved draft.
  const direct = await runCommand(app, shop.owner, 'campaign.post', await draftPayload(draft)).then(
    () => 'ran',
    () => 'refused',
  );
  await sweep();
  expect([direct, graph, await deliveries(campaign)]).toEqual(['refused', [], []]);
  expect((await decide(app, shop.owner, draft, 'approved')).status).toBe('executed');
  await sweep();
  expect(graph.map((c) => c.url.split('/').pop())).toEqual(['media', 'media_publish']);
  expect(await deliveries(campaign)).toMatchObject([{ mode: 'instagram', status: 'sent' }]);
});

it('LIVE2 a sample shop never sends for real, with the credentials wired, both grants and a listed recipient: its pending deliveries end blocked, no adapter called', async () => {
  graph.length = 0;
  const shop = await instagramShop('Sample with grants');
  await grant(live, shop.owner.tenantId, 'whatsapp');
  const p = await regular(shop);
  await listed(app, shop.owner, p);
  await inbound(pub, p.phone.slice(1), 'Haan ji');
  // D-080: the class is the tenant's. Today's schema ties it to the deployment, so the sample class is planted past
  // that trigger, as the migrator's per-tenant rule will allow; the database still derives `pending` for it here.
  await plant(live.admin, `update ops.tenant set data_class = 'synthetic' where tenant_id = $1`, [shop.owner.tenantId]);
  const send = await approveCampaign(shop);
  const post = await approveCampaign(shop, 'instagram');
  expect([...(await deliveries(send)), ...(await deliveries(post))].map((d) => d.mode)).toEqual(['pending', 'pending']);
  await sweep();
  expect(graph).toEqual([]);
  expect(await deliveries(send)).toMatchObject([{ mode: 'pending', status: 'blocked', provider_message_id: null }]);
  expect(await deliveries(post)).toMatchObject([{ mode: 'pending', status: 'blocked', provider_message_id: null }]);
  expect((await statesOf(shop)).map((x) => [x.channel, x.live, x.reason])).toEqual([
    ['whatsapp', false, 'sample_shop'],
    ['instagram', false, 'sample_shop'],
  ]);
});

it('LIVE3 a channel without its sender (no credential, or a recorded send mode) reaches no adapter: the post waits queued and lapses at its deadline; one still inside its window goes, once, when a sender is wired; the shop’s state says why', async () => {
  graph.length = 0;
  const shop = await instagramShop('Live no credential');
  expect((await statesOf(shop)).map((x) => [x.channel, x.live, x.reason])).toEqual([
    ['whatsapp', false, 'no_grant'],
    ['instagram', true, 'live'],
  ]);
  let lapsing = '';
  let waiting = '';
  try {
    // Instagram's credentials unset: the deploy wires WhatsApp alone.
    outbox.close();
    outbox = wireRecorded({ whatsapp: LIVE.whatsapp as Sender });
    lapsing = await approveCampaign(shop, 'instagram');
    await sweep();
    expect(await deliveries(lapsing)).toEqual([{ recipient_id: lapsing, mode: 'pending', status: 'queued', provider_message_id: null }]);
    expect((await statesOf(shop, { ...DEPLOY, instagramAccount: null }))[1]).toEqual({ channel: 'instagram', live: false, reason: 'no_credential' });
    // A recorded send mode wires no real sender, whatever credentials are set.
    outbox.close();
    const { recorded: _unused, ...wired } = channelsFor('recorded', LIVE.whatsapp as Sender, LIVE);
    outbox = wireRecorded(wired);
    waiting = await approveCampaign(shop, 'instagram');
    // The first post's deadline passes while no sender is wired (planted past the trigger that fixes the window).
    await plant(live.admin, `update ops.delivery set not_after = now() - interval '1 minute' where id = $1`, [await deliveryIdOf(lapsing)]);
    await sweep();
    expect(graph).toEqual([]);
    expect([(await deliveries(lapsing))[0]?.status, (await deliveries(waiting))[0]?.status]).toEqual(['expired', 'queued']);
    expect((await statesOf(shop, { ...DEPLOY, sendMode: 'recorded' }))[1]).toEqual({ channel: 'instagram', live: false, reason: 'send_mode' });
    // No public address for a post's card: the screen says so before anything is tried.
    expect((await statesOf(shop, { ...DEPLOY, instagramCard: false }))[1]).toEqual({ channel: 'instagram', live: false, reason: 'no_card' });
  } finally {
    outbox.close();
    outbox = wireRecorded(LIVE);
  }
  // The sender is back: the post still inside the window its approval gave goes, once; the lapsed one never does.
  await sweep();
  await sweep();
  expect(graph.map((c) => c.url.split('/').pop())).toEqual(['media', 'media_publish']);
  expect([(await deliveries(lapsing))[0]?.status, (await deliveries(waiting))[0]?.status]).toEqual(['expired', 'sent']);
});

it('LIVE4 one approved post is posted once: two sweeps at once and a third after make one container and one publish, and the draft cannot be approved again', async () => {
  graph.length = 0;
  const shop = await instagramShop('Live once');
  const campaign = await createCampaign(app, shop.owner, { name: 'Once', channel: 'instagram', segment: 'bought_within_days', segmentDays: 30 });
  await writeCopy(app, { session: shop.owner }, campaign, 'Naya maal aa gaya hai, dekhne aaiye!');
  const draft = await proposeCampaign(app, shop.owner, campaign);
  expect((await decide(app, shop.owner, draft, 'approved')).status).toBe('executed');
  // Both sweeps select the post as queued and wait on its row; let go together, one claims it, the other finds it taken.
  await raceForClaim(live, await deliveryIdOf(campaign), () => [sweep(), sweep()]);
  await sweep();
  expect(graph.map((c) => c.url.split('/').pop())).toEqual(['media', 'media_publish']);
  expect(await deliveries(campaign)).toMatchObject([{ mode: 'instagram', status: 'sent', provider_message_id: 'ig-media-1' }]);
  const again = await decide(app, shop.owner, draft, 'approved').then(
    (r) => r.status,
    () => 'refused',
  );
  await sweep();
  expect([again, graph.length]).toEqual(['refused', 2]);
});

it('LIVE5 no token reaches a log line or a delivery row, even when Meta answers an error that quotes it', async () => {
  graph.length = 0;
  const shop = await instagramShop('Live quiet');
  const written: string[] = [];
  const spies = [
    ...[process.stdout, process.stderr].map((stream) =>
      vi.spyOn(stream, 'write').mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      }),
    ),
    ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void written.push(args.map(String).join(' ')))),
  ];
  try {
    const ok = await approveCampaign(shop, 'instagram');
    await sweep();
    // Meta refuses the next post with an error that quotes the token.
    const quoting = (async (url: string | URL, init?: RequestInit) => {
      graph.push({ url: String(url), body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token: ig-token', type: 'OAuthException', code: 190 } }), { status: 400 });
    }) as typeof fetch;
    outbox.close();
    outbox = wireRecorded({
      ...LIVE,
      instagram: instagramGraph({ accounts: { founder_pro: { igUserId: '17800000001', token: 'ig-token' } }, mediaUrlFor: async () => 'https://shops.example/card.jpg', graphVersion: 'v99.0', host: 'graph.facebook.com', fetch: quoting }),
    });
    const refused = await approveCampaign(shop, 'instagram');
    await sweep();
    expect(await deliveries(ok)).toMatchObject([{ status: 'sent' }]);
    expect((await live.admin.query('select status, error_code from ops.delivery d join books.outbound_message m on m.id = d.message_id where m.campaign_id = $1', [refused])).rows).toEqual([
      { status: 'failed', error_code: '190' },
    ]);
  } finally {
    for (const spy of spies) spy.mockRestore();
    outbox.close();
    outbox = wireRecorded(LIVE);
  }
  expect(graph.filter((c) => c.auth === 'Bearer ig-token')).toHaveLength(3); // the token was used, so there was one to leak
  const rows = await live.admin.query<{ row: string }>(`select d::text as row from ops.delivery d where d.tenant_id = $1`, [shop.owner.tenantId]);
  for (const token of ['ig-token', 'test-token']) {
    expect(written.filter((w) => w.includes(token)), token).toEqual([]);
    expect(rows.rows.filter((r) => r.row.includes(token)), token).toEqual([]);
  }
});

it('LIVE6 outside the 24-hour window a listed customer’s campaign goes once, as the approved template the deploy holds', async () => {
  graph.length = 0;
  const shop = await grantedShop('Live template');
  const p = await regular(shop);
  await listed(app, shop.owner, p);
  const msg = (await inbound(pub, p.phone.slice(1), 'Offer kab tak hai?')) as string;
  await plant(live.admin, `update ops.inbound_message set received_at = now() - interval '25 hours' where id = $1`, [msg]);
  try {
    outbox.close();
    outbox = wireRecorded({
      ...LIVE,
      whatsapp: whatsAppCloud({ phoneNumberId: '1000000001', token: 'test-token', graphVersion: 'v99.0', fetch: fakeFetch, templates: { campaign: 'munshi_offer' }, language: 'hi' }),
      templates: { campaign: 'Namaste! {{1}}' },
    });
    const campaign = await approveCampaign(shop);
    await sweep();
    await sweep();
    expect(graph.map((c) => [c.body.type, (c.body.template as { name?: string } | undefined)?.name])).toEqual([['template', 'munshi_offer']]);
    expect(await deliveries(campaign)).toMatchObject([{ mode: 'cloud_api', status: 'sent' }]);
  } finally {
    outbox.close();
    outbox = wireRecorded(LIVE);
  }
});

it('LIVE7 at most once across a crash: a failure after Meta answered but before the outcome commits leaves the post sending, and no later sweep posts it again', async () => {
  graph.length = 0;
  const shop = await instagramShop('Live crash');
  const post = await approveCampaign(shop, 'instagram');
  // The outcome's commit fails, as a crash there would end it: planted as the superuser for this one delivery.
  const id = await deliveryIdOf(post);
  await live.admin.query(`create function ops.test_crash() returns trigger language plpgsql as $f$ begin raise exception 'crash before the outcome commits'; end $f$`);
  await live.admin.query(`create trigger test_crash before update on ops.delivery for each row when (new.id = '${id}' and new.status = 'sent') execute function ops.test_crash()`);
  let runs: Awaited<ReturnType<typeof sweep>>;
  try {
    runs = await sweep();
  } finally {
    await live.admin.query('drop trigger test_crash on ops.delivery; drop function ops.test_crash()');
  }
  expect(runs.find((r) => r.tenantId === shop.owner.tenantId)?.outcome).toBe('failed');
  expect(graph.map((c) => c.url.split('/').pop())).toEqual(['media', 'media_publish']);
  await sweep();
  await sweep();
  expect(graph).toHaveLength(2);
  expect(await deliveries(post)).toMatchObject([{ mode: 'instagram', status: 'sending', provider_message_id: null }]);
});

it('LIVE8 a send whose answer never came stays sending, unconfirmed: never marked failed, never sent again', async () => {
  graph.length = 0;
  const shop = await instagramShop('Live unconfirmed');
  // Meta takes the container; the publish call gets no answer (a timeout: it may have posted).
  const noAnswer = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith('/media_publish')) {
      graph.push({ url: String(url), body: JSON.parse(String(init?.body)), auth: null });
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }
    return fakeFetch(url, init);
  }) as typeof fetch;
  try {
    outbox.close();
    outbox = wireRecorded({
      ...LIVE,
      instagram: instagramGraph({ accounts: { founder_pro: { igUserId: '17800000001', token: 'ig-token' } }, mediaUrlFor: async () => 'https://shops.example/card.jpg', graphVersion: 'v99.0', host: 'graph.facebook.com', fetch: noAnswer }),
    });
    const post = await approveCampaign(shop, 'instagram');
    await sweep();
    await sweep();
    expect(graph.map((c) => c.url.split('/').pop())).toEqual(['media', 'media_publish']);
    expect((await live.admin.query('select status, error_code, provider_message_id from ops.delivery where id = $1', [await deliveryIdOf(post)])).rows).toEqual([
      { status: 'sending', error_code: null, provider_message_id: null },
    ]);
  } finally {
    outbox.close();
    outbox = wireRecorded(LIVE);
  }
});

it('LIVE9 a grant withdrawn, or a recipient unlisted, between approval and the sweep stops the send: blocked, the adapter never called', async () => {
  graph.length = 0;
  // WhatsApp, grant withdrawn.
  const revoked = await grantedShop('Live revoked');
  const p = await regular(revoked);
  await listed(app, revoked.owner, p);
  await inbound(pub, p.phone.slice(1), 'Haan ji');
  const send = await approveCampaign(revoked);
  expect((await deliveries(send)).map((d) => d.mode)).toEqual(['pending']);
  await grant(live, revoked.owner.tenantId, 'whatsapp', false);
  // WhatsApp, recipient unlisted (the owner's removal, planted).
  const unlisted = await grantedShop('Live unlisted');
  const q = await regular(unlisted);
  await listed(app, unlisted.owner, q);
  await inbound(pub, q.phone.slice(1), 'Haan ji');
  const sendTo = await approveCampaign(unlisted);
  await plant(live.admin, 'update ops.channel_recipient set removed_at = now() where tenant_id = $1', [unlisted.owner.tenantId]);
  // Instagram, grant withdrawn.
  const ig = await instagramShop('Live revoked post');
  const post = await approveCampaign(ig, 'instagram');
  await grant(live, ig.owner.tenantId, 'instagram', false, 'founder_pro');
  await sweep();
  expect(graph).toEqual([]);
  for (const c of [send, sendTo, post]) expect((await deliveries(c))[0]?.status, c).toBe('blocked');
});

it('LIVE10 Instagram is granted through a real platform change: a seventeen-digit account id cannot be an account_ref, its INSTAGRAM_ACCOUNT_REF alias is, and the shop then reads live (with a card address) or waiting only on the card', async () => {
  const op = await firstOperator(live);
  const shop = await realShop('Live alias');
  const settings = channelSettings({
    INSTAGRAM_ACCOUNT_REF: 'founder_pro',
    INSTAGRAM_BUSINESS_ACCOUNT_ID: '17841400000000001',
    INSTAGRAM_ACCESS_TOKEN: 'IGAA-unused',
    INSTAGRAM_APP_SECRET: 'x'.repeat(32),
    INSTAGRAM_VERIFY_TOKEN: 'verify-ig',
  });
  const ig = settings.instagram as NonNullable<typeof settings.instagram>;
  const platform = live.as('munshi_platform');
  const propose = async (accountRef: string) =>
    withOperator(platform, await signIn(live, op), (c) =>
      proposeChange(c, { kind: 'channel_grant', tenantId: shop.owner.tenantId, set: { channel: 'instagram', granted: true, max_test_recipients: 0, account_ref: accountRef } }),
    );
  const byId = await propose(ig.businessAccountId).then(
    () => 'proposed',
    () => 'refused',
  );
  expect(byId).toBe('refused');
  const { id } = await propose(ig.accountRef);
  const s = await signIn(live, op);
  const diff = await withOperator(platform, s, (c) => changeDiff(c, id));
  await withOperator(platform, s, (c) => approveChange(c, id, { digest: diff.digest, platformSecret: SECRETS.platformSecret, code: codeOf(op, 1) }));
  const deploy = channelDeployOf({ sendMode: 'live', instagram: ig }, true);
  expect((await statesOf(shop, deploy))[1]).toEqual({ channel: 'instagram', live: true, reason: 'live' });
  expect((await statesOf(shop, { ...deploy, instagramCard: false }))[1]).toEqual({ channel: 'instagram', live: false, reason: 'no_card' });
});
