// The relay against a stand-in for Switch, built from Switch's published protocol and its server source: the socket's
// auth and parameters, ping and pong, what it acts on, and how it recovers. This proves the relay keeps to that
// reading of the protocol; it is not a test against a real Switch server.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test } from 'vitest';
import { type WebSocket, WebSocketServer } from 'ws';
import { type Relay, startRelay, under } from '../src/relay.ts';

type Fake = {
  url: string;
  opens: URL[];
  auths: (string | undefined)[];
  pongs: unknown[];
  posted: { auth: string | undefined; body: { room_id: string; content: string } }[];
  turns: { auth: string | undefined; body: Record<string, string> }[];
  socket: () => WebSocket;
  munshiStatus: number;
  close: () => Promise<void>;
};

const read = async (req: IncomingMessage) => {
  let s = '';
  for await (const chunk of req) s += chunk;
  return JSON.parse(s);
};

async function fake(): Promise<Fake> {
  const f = { opens: [], auths: [], pongs: [], posted: [], turns: [], munshiStatus: 200 } as unknown as Fake;
  const server: Server = createServer(async (req, res) => {
    const body = await read(req);
    const auth = req.headers.authorization;
    if (req.url === '/api/internal/teammate') {
      f.turns.push({ auth, body });
      res.statusCode = f.munshiStatus;
      return res.end(JSON.stringify({ reply: `answer to ${body.text}` }));
    }
    f.posted.push({ auth, body });
    res.end('{"ok":true}');
  });
  const wss = new WebSocketServer({ server });
  let last: WebSocket;
  wss.on('connection', (ws, req) => {
    last = ws;
    f.opens.push(new URL(req.url as string, 'http://x'));
    f.auths.push(req.headers.authorization);
    ws.on('message', (raw) => f.pongs.push(JSON.parse(raw.toString())));
    ws.send(JSON.stringify({ event: 'connection_state', data: { rooms: ['room-1'], cursor: 10, generation: 3 } }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  f.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  f.socket = () => last;
  f.close = () =>
    new Promise((r) => {
      for (const c of wss.clients) c.terminate();
      wss.close();
      server.close(() => r());
    });
  return f;
}

let relay: Relay | undefined;
let f: Fake | undefined;
afterEach(async () => {
  relay?.stop();
  await f?.close();
});

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(ok()).toBe(true);
};

const start = (s: Fake) => {
  relay = startRelay({ switchUrl: s.url, agentId: 'agent-1', apiKey: 'agent-key', roomId: 'room-1', munshiUrl: s.url, munshiSecret: 'relay-secret', shop: 'sharma', retryMs: 5 });
  return relay;
};

const message = (id: number, payload: Record<string, unknown>) =>
  JSON.stringify({ event: 'message', id, data: { type: 'message', room_id: 'room-1', sequence: id, payload: { addressed: true, sender: '@switch-user-1:local', message_id: `m${id}`, body: 'brief', ...payload } } });

test('it opens the socket with the agent key, claims the room, and answers every ping', async () => {
  f = await fake();
  start(f);
  await until(() => f?.opens.length === 1);
  const url = f.opens[0] as URL;
  expect(url.pathname).toBe('/agents/agent-1/connection/ws');
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ rooms: 'room-1', filter: 'addressed', start_from: 'head' });
  expect(url.searchParams.get('connection_id')).toMatch(/^[0-9a-f-]{36}$/);
  expect(f.auths[0]).toBe('Bearer agent-key');
  f.socket().send(JSON.stringify({ event: 'ping', data: {} }));
  await until(() => f?.pongs.length === 1);
  expect(f.pongs[0]).toEqual({ type: 'pong', cursor: 10 });
});

test('a server behind a path keeps it, with or without a trailing slash', () => {
  expect(under('https://shop.example/switch', 'agents/a/message').href).toBe('https://shop.example/switch/agents/a/message');
  expect(under('https://shop.example/switch/', 'agents/a/message').href).toBe('https://shop.example/switch/agents/a/message');
  expect(under('http://localhost:8000', 'agents').href).toBe('http://localhost:8000/agents');
});

test('a message to the agent goes to Munshi with its sender, and the reply comes back to the room', async () => {
  f = await fake();
  start(f);
  await until(() => f?.opens.length === 1);
  f.socket().send(message(11, { body: '@munshi brief' }));
  await until(() => f?.posted.length === 1);
  expect(f.turns).toEqual([{ auth: 'Bearer relay-secret', body: { shop: 'sharma', channel: 'switch', sender: '@switch-user-1:local', text: '@munshi brief' } }]);
  expect(f.posted).toEqual([{ auth: 'Bearer agent-key', body: { room_id: 'room-1', content: 'answer to @munshi brief' } }]);
});

test('it acts on nothing else: not unaddressed, not a platform post, and not the same message twice', async () => {
  f = await fake();
  start(f);
  await until(() => f?.opens.length === 1);
  f.socket().send(message(11, { addressed: false }));
  f.socket().send(message(12, { sender_kind: 'platform' }));
  f.socket().send(message(13, {}));
  f.socket().send(message(14, { message_id: 'm13' }));
  await until(() => f?.posted.length === 1);
  await new Promise((r) => setTimeout(r, 30));
  expect(f.turns).toHaveLength(1);
});

test('when Munshi is down the room is told, in words that claim nothing changed hands', async () => {
  f = await fake();
  f.munshiStatus = 500;
  start(f);
  await until(() => f?.opens.length === 1);
  f.socket().send(message(11, {}));
  await until(() => f?.posted.length === 1);
  expect(f.posted[0]?.body.content).toContain('Nothing has changed');
});

test('a dropped socket reopens with the same connection, from its cursor and generation', async () => {
  f = await fake();
  start(f);
  await until(() => f?.opens.length === 1);
  f.socket().send(message(21, {}));
  await until(() => f?.posted.length === 1);
  f.socket().terminate();
  await until(() => f?.opens.length === 2);
  const [first, second] = f.opens as [URL, URL];
  expect(second.searchParams.get('connection_id')).toBe(first.searchParams.get('connection_id'));
  expect(second.searchParams.get('start_from')).toBe('21');
  expect(second.searchParams.get('expected_generation')).toBe('3');
});

test('being taken over, or refused for good, ends the relay instead of fighting', async () => {
  f = await fake();
  const r = start(f);
  await until(() => f?.opens.length === 1);
  f.socket().send(JSON.stringify({ event: 'evicted', data: { code: 'taken_over' } }));
  expect(await r.stopped).toBe('taken_over');

  const s = await fake();
  const again = start(s);
  await until(() => s.opens.length === 1);
  s.socket().close(4401);
  expect(await again.stopped).toBe('closed_4401');
  await s.close();
});
