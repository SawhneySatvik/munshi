// Red-proofs of a chat account standing for a member: the schema and core (test/v2/core/auth/chat-link.test.ts), the
// chat turn (apps/web/test/teammate.test.ts) and the relay (apps/teammate/test/relay.test.ts).
import type { Case } from './case.ts';
import { asOwner, mutate } from './sql.ts';

const FILE = 'test/v2/core/auth/chat-link.test.ts';
const V2 = 'vitest.v2.config.ts';
const GUARD = 'ops.chat_link_guard()';
const MEMBER = 'ops.member_chat_link()';
const SESSION = 'packages/core/src/session.ts';
const TURN = 'apps/web/lib/server/teammate.ts';
const ROUTE = 'apps/web/app/api/internal/teammate/route.ts';
const RELAY = 'apps/teammate/src/relay.ts';

const CHAT3 = 'CHAT3 a member opens only their own link, with a code, and a linked account never moves';
const CHAT4 = 'CHAT4 a revoked or lapsed link is no session, and a deactivated member loses every link';
const CHAT5 = 'CHAT5 another shop neither reads nor uses a link, and neither does the agent role';
const CHAT6 = 'CHAT6 an erased member’s chat account is erased with them, and only with them';
const CHAT7 = 'CHAT7 a link carries its session’s via, and a sample link is never a session on a real shop';
const TEAM2 = "TEAM2 the brief's figures are stored cells with their sources, and a sample shop says so";
const TEAM4 = 'TEAM4 a rejection needs a reason, and a code naming no draft decides nothing';
const TEAM5 = "TEAM5 the route admits only the relay's secret";
const TEAM7 = 'TEAM7 a fix is drafted from chat and changes nothing until someone decides it';
const PATH = 'a server behind a path keeps it, with or without a trailing slash';
const PING = 'it opens the socket with the agent key, claims the room, and answers every ping';
const ONLY = 'it acts on nothing else: not unaddressed, not a platform post, and not the same message twice';

const sql = (test: string, sabotage: string, text: string): Case => ({ sabotage, file: FILE, test, config: V2, sql: asOwner(text) });
const core = (test: string, sabotage: string, from: string, to: string): Case => ({ sabotage, file: FILE, test, config: V2, ts: { file: SESSION, from, to } });
const web = (test: string, sabotage: string, file: string, from: string, to: string): Case => ({
  sabotage,
  dir: 'apps/web',
  config: 'vitest.config.ts',
  file: 'test/teammate.test.ts',
  test,
  ts: { file, from, to },
});
const relay = (test: string, sabotage: string, from: string, to: string): Case => ({
  sabotage,
  dir: 'apps/teammate',
  config: 'vitest.config.ts',
  file: 'test/relay.test.ts',
  test,
  ts: { file: RELAY, from, to },
});

// Held twice on a tenant turned real: its class, and that a real shop is open only once accepted. Broken as one.
const SAMPLE = `  if (!r || !r.active || !r.open) return null;\n  if (r.via !== 'real' && r.data_class === 'live') return null;`;

export const CHAT_LINK_CASES: Case[] = [
  sql(CHAT3, 'v2-chat-open-for-another', mutate(GUARD, 'new.member_id is distinct from ctx_actor\n       or ', '')),
  sql(CHAT3, 'v2-chat-long-code', mutate(GUARD, "or new.expires_at > now() + interval '30 minutes'", '')),
  sql(CHAT3, 'v2-chat-link-moves', mutate(GUARD, 'old.sender_ref is not null or old.linked_at is not null or ', '')),
  sql(CHAT4, 'v2-chat-revoke-anyones', mutate(GUARD, 'old.expires_at > now() and pg_trigger_depth() < 2 and ctx_actor is distinct from old.member_id', 'false')),
  sql(CHAT4, 'v2-chat-deactivate-keeps', mutate(MEMBER, 'if old.active and not new.active then', 'if false then')),
  sql(CHAT5, 'v2-chat-rls-open', 'drop policy tenant_isolation on ops.chat_link; create policy tenant_isolation on ops.chat_link using (true) with check (true);'),
  sql(CHAT5, 'v2-chat-agent-reads', 'grant usage on schema ops to munshi_agent; grant select on ops.chat_link to munshi_agent;'),
  sql(CHAT6, 'v2-chat-erase-keeps', mutate(MEMBER, 'if old.erased_at is null and new.erased_at is not null then', 'if false then')),
  sql(CHAT6, 'v2-chat-erase-direct', mutate(GUARD, 'if pg_trigger_depth() < 2 then', 'if false then')),
  core(CHAT4, 'v2-chat-revoked-session', 'and l.linked_at is not null and l.revoked_at is null and l.expires_at > now()', 'and l.linked_at is not null and l.expires_at > now()'),
  core(CHAT4, 'v2-chat-lapsed-session', 'and l.linked_at is not null and l.revoked_at is null and l.expires_at > now()', 'and l.linked_at is not null and l.revoked_at is null'),
  core(CHAT7, 'v2-chat-sample-on-real', SAMPLE, '  if (!r || !r.active) return null;'),
  web(TEAM2, 'web-team-free-figure', TURN, 'const shown = resolveNumber(this.snapshots, ref);', 'const shown = "₹1";'),
  web(TEAM2, 'web-team-source-by-label', TURN, 'const key = `${ref.snapshotId}:${ref.row}`;', 'const key = `${ref.label.en}:${ref.row}`;'),
  web(TEAM2, 'web-team-no-sample-label', TURN, 'return session.via === "real" ? text : `${text}\\n\\nSample shop: synthetic data, simulated suppliers.`;', 'return text;'),
  web(TEAM4, 'web-team-reject-no-reason', TURN, 'if (!said.reason) return `Say why, as: reject ${said.tail} not_now. The reasons are: ${REASONS.join(", ")}`;', ''),
  web(TEAM5, 'web-team-open-route', ROUTE, 'if (!authorized(request)) return new Response(null, { status: 404 });', ''),
  web(TEAM7, 'web-team-fix-shows-all', TURN, 'const cards = draftsOf(await loadHome(session), made);', 'const cards = draftsOf(await loadHome(session));'),
  relay(PATH, 'relay-drops-base-path', "new URL(path, base.endsWith('/') ? base : `${base}/`)", 'new URL(`/${path}`, base)'),
  relay(PING, 'relay-no-pong', "ws.send(JSON.stringify({ type: 'pong', cursor: cursor ?? 0 }));", ''),
  relay(ONLY, 'relay-unaddressed', 'if (!p.addressed || !p.sender', 'if (!p.sender'),
  relay(ONLY, 'relay-platform-post', ' || p.sender_kind) return;', ') return;'),
  relay(ONLY, 'relay-repeat', 'if (seen.has(p.message_id)) return;', ''),
];
