// The relay between a Switch room and Munshi. Switch delivers the room over one WebSocket and asks for a pong to each
// ping (the socket lapses after a few seconds without one), so this is a long-running process, never a serverless
// function. It holds no shop logic: each message addressed to the agent goes to Munshi's internal route with the sender
// Switch names, and the answer comes back to the room. Who that sender may act as is decided in Munshi.
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

export type RelayOptions = {
  switchUrl: string;
  agentId: string;
  apiKey: string;
  roomId: string;
  munshiUrl: string;
  munshiSecret: string;
  shop: string;
  /** Fixed fields only: a status or a code, never a message or a sender. */
  log?: (event: string, fields?: { status?: number; code?: string }) => void;
  /** Milliseconds before the first reconnect; it doubles up to 30 seconds. */
  retryMs?: number;
};

export type Relay = { stop: () => void; stopped: Promise<string> };

type Frame = { event?: string; data?: Record<string, unknown>; id?: number };
type MessagePayload = { addressed?: boolean; sender?: string; sender_kind?: string; message_id?: string; body?: string };

// The chat account's namespace in Munshi. A Switch participant id already says which person it is, on any chat app.
const CHANNEL = 'switch';
const UNREACHABLE = "I can't reach the shop's books right now. Nothing has changed. Try again in a moment.";
// Refused for good: bad credentials, a room this agent may not serve, another process holding the connection.
const FINAL_CLOSE = new Set([4401, 4403, 4409]);
const SEEN_LIMIT = 500;

/** `path` under `base`, keeping any path the base has: a server may sit behind a prefix. */
export const under = (base: string, path: string) => new URL(path, base.endsWith('/') ? base : `${base}/`);

export function startRelay(o: RelayOptions): Relay {
  const log = o.log ?? (() => {});
  const connectionId = randomUUID();
  const seen = new Set<string>();
  let cursor: number | null = null;
  let generation: number | null = null;
  let socket: WebSocket | undefined;
  let timer: NodeJS.Timeout | undefined;
  let stopping = false;
  let retry = o.retryMs ?? 1_000;
  // Messages are answered one at a time, in order: a decision and the question after it must not cross.
  let queue: Promise<void> = Promise.resolve();
  let finish: (why: string) => void = () => {};
  const stopped = new Promise<string>((resolve) => {
    finish = resolve;
  });

  const end = (why: string) => {
    stopping = true;
    clearTimeout(timer);
    socket?.close();
    finish(why);
  };

  const socketUrl = () => {
    const url = under(o.switchUrl, `agents/${o.agentId}/connection/ws`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('connection_id', connectionId);
    url.searchParams.set('rooms', o.roomId);
    url.searchParams.set('filter', 'addressed');
    url.searchParams.set('start_from', cursor === null ? 'head' : String(cursor));
    if (generation !== null) url.searchParams.set('expected_generation', String(generation));
    return url;
  };

  const post = async (content: string) => {
    const res = await fetch(under(o.switchUrl, `agents/${o.agentId}/message`), {
      method: 'POST',
      headers: { authorization: `Bearer ${o.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ room_id: o.roomId, content }),
    });
    if (!res.ok) log('post_failed', { status: res.status });
  };

  const ask = async (sender: string, text: string): Promise<string> => {
    try {
      const res = await fetch(under(o.munshiUrl, 'api/internal/teammate'), {
        method: 'POST',
        headers: { authorization: `Bearer ${o.munshiSecret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ shop: o.shop, channel: CHANNEL, sender, text }),
      });
      if (res.ok) return ((await res.json()) as { reply: string }).reply;
      log('munshi_failed', { status: res.status });
    } catch {
      log('munshi_failed');
    }
    return UNREACHABLE;
  };

  const onMessage = (p: MessagePayload) => {
    // Only a person speaking to the agent. A platform client's post names its client as the sender, not the person.
    if (!p.addressed || !p.sender || !p.body || p.sender_kind) return;
    if (p.message_id) {
      if (seen.has(p.message_id)) return;
      seen.add(p.message_id);
      if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value as string);
    }
    const { sender, body } = p as { sender: string; body: string };
    queue = queue.then(() => ask(sender, body)).then(post, () => log('turn_failed'));
  };

  const onFrame = (ws: WebSocket, frame: Frame) => {
    const data = frame.data ?? {};
    switch (frame.event) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', cursor: cursor ?? 0 }));
        return;
      case 'connection_state':
        retry = o.retryMs ?? 1_000;
        if (typeof data.generation === 'number') generation = data.generation;
        if (typeof data.cursor === 'number') cursor = Math.max(cursor ?? 0, data.cursor);
        log('connected');
        return;
      case 'evicted':
        log('evicted', { code: String(data.code) });
        if (data.code === 'taken_over') end('taken_over');
        return;
      case 'refused':
        log('refused', { status: Number(data.status) });
        return;
      case 'gap':
        log('gap', { code: String(data.reason) });
        return;
      case 'message':
        if (typeof frame.id === 'number') cursor = Math.max(cursor ?? 0, frame.id);
        onMessage((data.payload ?? {}) as MessagePayload);
        return;
      default:
        if (typeof frame.id === 'number') cursor = Math.max(cursor ?? 0, frame.id);
    }
  };

  const open = () => {
    const ws = new WebSocket(socketUrl(), { headers: { authorization: `Bearer ${o.apiKey}` } });
    socket = ws;
    ws.on('message', (raw) => {
      try {
        onFrame(ws, JSON.parse(raw.toString()) as Frame);
      } catch {
        log('bad_frame');
      }
    });
    ws.on('error', () => log('socket_error'));
    ws.on('close', (code) => {
      if (stopping) return;
      if (FINAL_CLOSE.has(code)) return end(`closed_${code}`);
      log('reconnecting', { status: code });
      timer = setTimeout(open, retry);
      retry = Math.min(retry * 2, 30_000);
    });
  };

  open();
  return { stop: () => end('stopped'), stopped };
}
