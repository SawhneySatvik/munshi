// The channel adapters (packages/adapters/channels): no network, every fetch answered here as Meta's public docs show.
// W1's part in the adapter (the webhook's signature over the raw body, the route that answers 401 being the app's); the
// WhatsApp Cloud request in Meta's shape, an error kept as its numeric code only; Instagram posting only for a
// configured account a grant names, with the card's URL; the webhook's payload read without the sender's profile name;
// the one switch that gives a deploy its real senders only when its send mode is live; a send outside WhatsApp's window
// only as an approved template; every Meta call's timeout; Instagram's webhook read; and each channel's state, live or
// recorded with its reason. Red-proofs: test/v2/sabotage/core-messaging.ts and live-channels.ts.
import { createHmac } from 'node:crypto';
import { type ChannelDeploy, channelState, templateFits } from '@munshi/core';
import { expect, it } from 'vitest';
import {
  channelsFor,
  instagramGraph,
  type Outbound,
  outboxDir,
  parseInstagramWebhook,
  parseWhatsAppWebhook,
  recordedSender,
  verifyMetaSignature,
  verifyWhatsAppSignature,
  whatsAppCloud,
} from '../../../../../packages/adapters/channels/index.ts';

const SECRET = 'app-secret-for-tests';
const sign = (body: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

type Call = { url: string; body: unknown };
const fetchAnswering = (answers: unknown[]) => {
  const calls: Call[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const a = answers.shift();
    if (a instanceof Error) throw a;
    return new Response(JSON.stringify(a), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, calls };
};
const message = (m: Partial<Outbound> = {}): Outbound => ({
  deliveryId: '019a0000-0000-7000-8000-000000000001',
  tenantId: '019a0000-0000-7000-8000-0000000000aa',
  channel: 'whatsapp',
  to: '+919812345678',
  body: 'Naya maal aa gaya hai',
  campaignId: null,
  accountRef: null,
  window: true,
  purpose: null,
  ...m,
});

it('a webhook body is accepted only with its own signature: a missing, malformed, forged, other-body or other-secret one is refused', () => {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  expect(verifyWhatsAppSignature(body, sign(body), SECRET)).toBe(true);
  expect(verifyWhatsAppSignature(Buffer.from(body), sign(body), SECRET)).toBe(true);
  const refused = [
    verifyWhatsAppSignature(body, undefined, SECRET),
    verifyWhatsAppSignature(body, '', SECRET),
    verifyWhatsAppSignature(body, sign(body).slice(7), SECRET), // no sha256= prefix
    verifyWhatsAppSignature(body, `sha256=${'0'.repeat(64)}`, SECRET),
    verifyWhatsAppSignature(body, sign(`${body} `), SECRET),
    verifyWhatsAppSignature(body, sign(body, 'another-secret'), SECRET),
    verifyWhatsAppSignature(body, sign(body), ''), // no secret configured admits no one
  ];
  expect(refused).toEqual([false, false, false, false, false, false, false]);
});

it('WhatsApp Cloud sends a text in Meta’s shape and keeps only an error’s numeric code, never its text', async () => {
  const { f, calls } = fetchAnswering([
    { messaging_product: 'whatsapp', contacts: [{ input: '919812345678', wa_id: '919812345678' }], messages: [{ id: 'wamid.HBgM' }] },
    { error: { message: 'Re-engagement message: more than 24 hours since +919812345678 replied', type: 'OAuthException', code: 131047, fbtrace_id: 'Ax1' } },
    new Error('getaddrinfo ENOTFOUND graph.facebook.com'),
  ]);
  const send = whatsAppCloud({ phoneNumberId: '1000000001', token: 't', graphVersion: 'v99.0', fetch: f });
  expect(await send(message())).toEqual({ ok: true, providerMessageId: 'wamid.HBgM' });
  const failed = await send(message());
  expect(failed).toEqual({ ok: false, errorCode: '131047' });
  expect(JSON.stringify(failed)).not.toMatch(/hours|\+91|OAuth/);
  // No answer at all: the request may have reached Meta, so it is unconfirmed, not a failure.
  expect(await send(message())).toEqual({ ok: false, errorCode: null, unconfirmed: true });
  expect(calls[0]).toEqual({
    url: 'https://graph.facebook.com/v99.0/1000000001/messages',
    body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: '919812345678', type: 'text', text: { preview_url: false, body: 'Naya maal aa gaya hai' } },
  });
  expect(await send(message({ channel: 'sms' }))).toEqual({ ok: false, errorCode: null });
  expect(calls).toHaveLength(3);
});

it('Instagram posts only for a configured account the shop’s grant names, with its card: an unknown account or no card posts nothing', async () => {
  const { f, calls } = fetchAnswering([{ id: 'container-9' }, { id: 'ig-media-9' }]);
  const post = instagramGraph({
    accounts: { shop_pro: { igUserId: '17800000001', token: 'ig' } },
    mediaUrlFor: async (_t, campaign) => (campaign === 'c-with-card' ? 'https://shops.example/card.jpg' : null),
    graphVersion: 'v99.0',
    host: 'graph.facebook.com',
    fetch: f,
  });
  const ig = (m: Partial<Outbound>) => post(message({ channel: 'instagram', to: null, campaignId: 'c-with-card', accountRef: 'shop_pro', ...m }));
  expect(await ig({ accountRef: 'strangers_account' })).toEqual({ ok: false, errorCode: null });
  expect(await ig({ accountRef: null })).toEqual({ ok: false, errorCode: null });
  expect(await ig({ campaignId: 'c-without-card' })).toEqual({ ok: false, errorCode: null });
  expect(calls).toEqual([]);
  expect(await ig({})).toEqual({ ok: true, providerMessageId: 'ig-media-9' });
  expect(calls).toEqual([
    { url: 'https://graph.facebook.com/v99.0/17800000001/media', body: { image_url: 'https://shops.example/card.jpg', caption: 'Naya maal aa gaya hai' } },
    { url: 'https://graph.facebook.com/v99.0/17800000001/media_publish', body: { creation_id: 'container-9' } },
  ]);
});

it('the webhook’s payload is read into messages and statuses; the sender’s profile name is dropped and a malformed item skipped', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550000000', phone_number_id: '1000000001' },
              contacts: [{ profile: { name: 'Synthetic Sender' }, wa_id: '919812345678' }],
              messages: [
                { from: '919812345678', id: 'wamid.A', timestamp: '1761700000', type: 'text', text: { body: 'STOP' } },
                { from: '919812345678', id: 'wamid.B', timestamp: '1761700001', type: 'audio', audio: { id: 'media-1', mime_type: 'audio/ogg; codecs=opus', voice: true } },
                { from: '919812345678', timestamp: '1761700002', type: 'text', text: { body: 'no id' } },
              ],
              statuses: [{ id: 'wamid.OUT', status: 'failed', timestamp: '1761700003', recipient_id: '919812345678', errors: [{ code: 131049, title: 'marketing cap' }] }],
            },
          },
        ],
      },
    ],
  };
  const read = parseWhatsAppWebhook(payload);
  expect(read).toEqual({
    messages: [
      { phoneNumberId: '1000000001', providerMessageId: 'wamid.A', from: '919812345678', kind: 'text', text: 'STOP', mediaId: null },
      { phoneNumberId: '1000000001', providerMessageId: 'wamid.B', from: '919812345678', kind: 'audio', text: null, mediaId: 'media-1' },
    ],
    statuses: [{ phoneNumberId: '1000000001', providerMessageId: 'wamid.OUT', status: 'failed', recipient: '919812345678', errorCode: '131049' }],
  });
  expect(JSON.stringify(read)).not.toContain('Synthetic Sender');
  expect(parseWhatsAppWebhook({ object: 'page', entry: payload.entry })).toEqual({ messages: [], statuses: [] });
});

it('a deploy gets the real senders only when its send mode is live; every other gets the recorded sender alone', () => {
  const recorded = recordedSender('/nowhere');
  const live = { whatsapp: recordedSender('/w'), instagram: recordedSender('/i'), templates: { campaign: 'Namaste! {{1}}' } };
  for (const d of ['recorded', 'demo', 'Live', '']) expect(Object.keys(channelsFor(d, recorded, live)), d).toEqual(['recorded']);
  expect(Object.keys(channelsFor('live', recorded, live)).sort()).toEqual(['instagram', 'recorded', 'templates', 'whatsapp']);
  // A channel with no credentials gets no sender, live or not.
  expect(Object.keys(channelsFor('live', recorded, {}))).toEqual(['recorded']);
});

it('the outbox folder is read from MUNSHI_OUTBOX_DIR, and unset is an error, never a guess', () => {
  const was = process.env.MUNSHI_OUTBOX_DIR;
  try {
    delete process.env.MUNSHI_OUTBOX_DIR;
    expect(() => outboxDir()).toThrow('channels: MUNSHI_OUTBOX_DIR is not set');
    process.env.MUNSHI_OUTBOX_DIR = '/tmp/outbox-for-test';
    expect(outboxDir()).toBe('/tmp/outbox-for-test');
  } finally {
    if (was === undefined) delete process.env.MUNSHI_OUTBOX_DIR;
    else process.env.MUNSHI_OUTBOX_DIR = was;
  }
});

it('WhatsApp outside the 24-hour window sends only its purpose’s approved template, the words as its one parameter; with none it sends nothing', async () => {
  const { f, calls } = fetchAnswering([{ messages: [{ id: 'wamid.T1' }] }, { messages: [{ id: 'wamid.T2' }] }]);
  const send = whatsAppCloud({ phoneNumberId: '1000000001', token: 't', graphVersion: 'v99.0', fetch: f, templates: { campaign: 'munshi_offer' }, language: 'hi' });
  const outside = (m: Partial<Outbound>) => send(message({ window: false, body: 'Naya maal aa  gaya hai', ...m }));
  expect(await outside({ purpose: null })).toEqual({ ok: false, errorCode: null });
  expect(await outside({ purpose: 'credit_due' })).toEqual({ ok: false, errorCode: null }); // no template for it
  expect(calls).toEqual([]);
  expect(await outside({ purpose: 'campaign' })).toEqual({ ok: true, providerMessageId: 'wamid.T1' });
  expect(calls[0]?.body).toEqual({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '919812345678',
    type: 'template',
    // The approved words go unchanged: nothing is collapsed or trimmed.
    template: { name: 'munshi_offer', language: { code: 'hi' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Naya maal aa  gaya hai' }] }] },
  });
  // Inside the window the same campaign goes as its own words.
  expect(await send(message({ purpose: 'campaign' }))).toEqual({ ok: true, providerMessageId: 'wamid.T2' });
  expect((calls[1]?.body as { type?: string } | undefined)?.type).toBe('text');
});

it('every Meta call gives up after its timeout: a hung WhatsApp or Instagram call fails, it never holds the sweep', async () => {
  const hung = (async (_url: string | URL, init?: RequestInit) =>
    new Promise((_, reject) => {
      if (!init?.signal) return; // no timeout: hangs for good, and the test's own timeout fails it
      init.signal.addEventListener('abort', () => reject(init.signal?.reason));
    })) as typeof fetch;
  const wa = whatsAppCloud({ phoneNumberId: '1000000001', token: 't', graphVersion: 'v99.0', fetch: hung, timeoutMs: 50 });
  const ig = instagramGraph({
    accounts: { '17800000001': { igUserId: '17800000001', token: 'ig' } },
    mediaUrlFor: async () => 'https://shops.example/card.jpg',
    graphVersion: 'v99.0',
    host: 'graph.instagram.com',
    fetch: hung,
    timeoutMs: 50,
  });
  // WhatsApp's request went out and no answer came: unconfirmed. Instagram's container call is the first, and a
  // container alone publishes nothing: a plain failure.
  expect(await wa(message())).toEqual({ ok: false, errorCode: null, unconfirmed: true });
  expect(await ig(message({ channel: 'instagram', to: null, campaignId: 'c', accountRef: '17800000001' }))).toEqual({ ok: false, errorCode: null });
}, 5_000);

it('Instagram posts through the host its login names, and never with a card that is not a public HTTPS address', async () => {
  const { f, calls } = fetchAnswering([{ id: 'container-1' }, { id: 'ig-media-1' }]);
  let url: string | null = 'http://shops.example/card.jpg';
  const post = instagramGraph({
    accounts: { '17841400000000001': { igUserId: '17841400000000001', token: 'ig' } },
    mediaUrlFor: async () => url,
    graphVersion: 'v99.0',
    host: 'graph.instagram.com',
    fetch: f,
  });
  const m = message({ channel: 'instagram', to: null, campaignId: 'c', accountRef: '17841400000000001' });
  expect(await post(m)).toEqual({ ok: false, errorCode: null });
  expect(calls).toEqual([]);
  url = 'https://shops.example/card.jpg';
  expect(await post(m)).toEqual({ ok: true, providerMessageId: 'ig-media-1' });
  expect(calls.map((c) => c.url)).toEqual([
    'https://graph.instagram.com/v99.0/17841400000000001/media',
    'https://graph.instagram.com/v99.0/17841400000000001/media_publish',
  ]);
});

it('Instagram’s webhook is read into direct messages and comments by the person’s scoped id; the shop’s own, deleted and malformed items are skipped, usernames dropped', () => {
  const account = '17841400000000001';
  const payload = {
    object: 'instagram',
    entry: [
      {
        id: account,
        time: 1761700000,
        messaging: [
          { sender: { id: '9000000000000001' }, recipient: { id: account }, timestamp: 1761700001, message: { mid: 'aWdfZAG1', text: 'Kya yeh blue mein hai?' } },
          { sender: { id: '9000000000000001' }, recipient: { id: account }, message: { mid: 'aWdfZAG2', attachments: [{ type: 'image', payload: { url: 'https://cdn.example/x.jpg' } }] } },
          { sender: { id: account }, recipient: { id: '9000000000000001' }, message: { mid: 'aWdfZAG3', text: 'our reply', is_echo: true } },
          { sender: { id: '9000000000000001' }, recipient: { id: account }, message: { mid: 'aWdfZAG4', is_deleted: true } },
          { sender: { id: 'not-digits' }, recipient: { id: account }, message: { mid: 'aWdfZAG5', text: 'x' } },
          { sender: { id: '9000000000000002' }, recipient: { id: account }, message: { text: 'no mid' } },
        ],
        changes: [
          { field: 'comments', value: { id: '18000000000000001', from: { id: '9000000000000003', username: 'synthetic_user' }, text: 'Price?', media: { id: '18000000000000099' } } },
          { field: 'comments', value: { comment_id: '18000000000000002', from: { id: '9000000000000004', username: 'synthetic_user_2' }, text: 'Kitne ka?' } },
          { field: 'mentions', value: { comment_id: '18000000000000003', media_id: '1' } },
        ],
      },
    ],
  };
  const read = parseInstagramWebhook([payload]);
  expect(read).toEqual([
    { accountId: account, source: 'message', providerMessageId: 'aWdfZAG1', from: '9000000000000001', kind: 'text', text: 'Kya yeh blue mein hai?' },
    { accountId: account, source: 'message', providerMessageId: 'aWdfZAG2', from: '9000000000000001', kind: 'image', text: null },
    { accountId: account, source: 'comment', providerMessageId: '18000000000000001', from: '9000000000000003', kind: 'text', text: 'Price?' },
    { accountId: account, source: 'comment', providerMessageId: '18000000000000002', from: '9000000000000004', kind: 'text', text: 'Kitne ka?' },
  ]);
  expect(JSON.stringify(read)).not.toContain('synthetic_user');
  expect(parseInstagramWebhook(payload)).toEqual(read); // a bare body reads the same
  expect(parseInstagramWebhook({ ...payload, object: 'page' })).toEqual([]);
  // Meta signs it as it signs WhatsApp's.
  const body = JSON.stringify(payload);
  expect(verifyMetaSignature(body, sign(body), SECRET)).toBe(true);
  expect(verifyMetaSignature(body, sign(body, 'another-secret'), SECRET)).toBe(false);
});

it('a channel is live only for a real shop on a live send mode with its credential and the grant (Instagram’s naming the account held, with a public card address); else recorded with the first reason', () => {
  const deploy: ChannelDeploy = { sendMode: 'live', whatsapp: true, instagramAccount: '17841400000000001', instagramCard: true };
  const wa = { granted: true, accountRef: null };
  const ig = { granted: true, accountRef: '17841400000000001' };
  const state = (channel: 'whatsapp' | 'instagram', dataClass: string, grant: { granted: boolean; accountRef: string | null } | null, d = deploy) =>
    channelState(channel, dataClass, grant, d);
  expect(state('whatsapp', 'live', wa)).toEqual({ channel: 'whatsapp', live: true, reason: 'live_listed' });
  expect(state('instagram', 'live', ig)).toEqual({ channel: 'instagram', live: true, reason: 'live' });
  // A sample shop is recorded with everything else in place, whatever its class's name.
  for (const dataClass of ['synthetic', 'showcase', '']) {
    expect(state('whatsapp', dataClass, wa).reason, dataClass).toBe('sample_shop');
    expect(state('instagram', dataClass, ig).live, dataClass).toBe(false);
  }
  expect(state('whatsapp', 'live', wa, { ...deploy, sendMode: 'recorded' })).toEqual({ channel: 'whatsapp', live: false, reason: 'send_mode' });
  expect(state('whatsapp', 'live', wa, { ...deploy, whatsapp: false }).reason).toBe('no_credential');
  expect(state('instagram', 'live', ig, { ...deploy, instagramAccount: null }).reason).toBe('no_credential');
  expect(state('whatsapp', 'live', null).reason).toBe('no_grant');
  expect(state('whatsapp', 'live', { granted: false, accountRef: null }).reason).toBe('no_grant');
  expect(state('instagram', 'live', { granted: true, accountRef: null }).reason).toBe('no_account');
  expect(state('instagram', 'live', { granted: true, accountRef: 'another_account' }).reason).toBe('no_account');
  // No public address for a post's card: Instagram is recorded; WhatsApp is not concerned.
  expect(state('instagram', 'live', ig, { ...deploy, instagramCard: false })).toEqual({ channel: 'instagram', live: false, reason: 'no_card' });
  expect(state('whatsapp', 'live', wa, { ...deploy, instagramCard: false }).live).toBe(true);
});

it('the words go as a template only when its approved text is known and they fit it unchanged: one line, no long run of spaces, the whole at most 1024 characters', () => {
  const text = 'Namaste! {{1}} Reply STOP to stop these messages.';
  expect(templateFits(text, 'Naya maal aa gaya hai, dekhne aaiye!')).toBe(true);
  expect(templateFits(text, 'Naya maal  aa gaya hai')).toBe(true); // two spaces are the words' own
  expect(templateFits(undefined, 'Naya maal')).toBe(false); // no known approved text: it waits
  expect(templateFits(text, null)).toBe(false);
  expect(templateFits(text, 'Naya maal\naa gaya hai')).toBe(false);
  expect(templateFits(text, 'Naya\tmaal')).toBe(false);
  expect(templateFits(text, 'Naya maal     aa gaya')).toBe(false);
  const room = 1024 - (text.length - '{{1}}'.length);
  expect(templateFits(text, 'a'.repeat(room))).toBe(true);
  expect(templateFits(text, 'a'.repeat(room + 1))).toBe(false);
});
