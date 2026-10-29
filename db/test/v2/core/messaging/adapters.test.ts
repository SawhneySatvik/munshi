// The channel adapters (packages/adapters/channels): no network, every fetch answered here as Meta's public docs show.
// W1's part in the adapter (the webhook's signature over the raw body, the route that answers 401 being BP-F3b's); the
// WhatsApp Cloud request in Meta's shape, an error kept as its numeric code only; Instagram posting only for a
// configured account a grant names, with the card's URL; the webhook's payload read without the sender's profile name;
// and the one switch that gives a deploy its real senders only when it is live. Red-proofs:
// test/v2/sabotage/core-messaging.ts.
import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  channelsFor,
  instagramGraph,
  type Outbound,
  outboxDir,
  parseWhatsAppWebhook,
  recordedSender,
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
  ...m,
});

it('W1 a webhook body is accepted only with its own signature: a missing, malformed, forged, other-body or other-secret one is refused', () => {
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
  expect(await send(message())).toEqual({ ok: false, errorCode: null });
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
    accounts: { founder_pro: { igUserId: '17800000001', token: 'ig' } },
    mediaUrlFor: async (_t, campaign) => (campaign === 'c-with-card' ? 'https://shops.example/card.jpg' : null),
    graphVersion: 'v99.0',
    fetch: f,
  });
  const ig = (m: Partial<Outbound>) => post(message({ channel: 'instagram', to: null, campaignId: 'c-with-card', accountRef: 'founder_pro', ...m }));
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

it('a deploy gets the real senders only when it is live; every other gets the recorded sender alone', () => {
  const recorded = recordedSender('/nowhere');
  const live = { whatsapp: recordedSender('/w'), instagram: recordedSender('/i') };
  for (const d of ['demo', 'sandbox', 'local', '']) expect(Object.keys(channelsFor(d, recorded, live)), d).toEqual(['recorded']);
  expect(Object.keys(channelsFor('live', recorded, live)).sort()).toEqual(['instagram', 'recorded', 'whatsapp']);
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
