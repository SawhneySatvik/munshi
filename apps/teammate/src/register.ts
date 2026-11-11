// Registers Munshi as a Switch agent, once, and lets anyone in its rooms address it. Everyone may speak to it because
// Munshi decides what each person may do; an account with no link gets nothing back but how to link. Switch shows the
// agent's key only here, so it goes to .env.switch, never to the console, with a new secret for the relay and the web
// app to share. Only you can read the file; the relay and `pnpm dev` both load it.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { loadEnvFiles, relayRegistration } from '@munshi/config';
import { log } from '@munshi/core/log';
import { under } from './relay.ts';

loadEnvFiles([new URL('../../../.env', import.meta.url)]);
const { switchUrl, registrationKey } = relayRegistration();

const send = async (path: string, key: string, body: unknown) => {
  const res = await fetch(under(switchUrl, path), {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Switch answered ${res.status} on ${path}: ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
};

const agent = await send('agents', registrationKey, {
  name: 'munshi',
  display_name: 'Munshi',
  description: "The shop's back office: answers from the books, drafts fixes, and changes nothing without a named person's approval.",
  connector_type: 'munshi',
  integration_profile: { connection_model: 'always_on', message_exchange: true, pre_invocation_mediation: [], post_invocation_mediation: [], event_reporting: [] },
});
const id = agent.id as string;
await send(`agents/${id}/ops/update_agent_detail`, agent.api_key as string, { agent_id: id, addressing: 'anyone' });
const secret = randomBytes(32).toString('hex');
writeFileSync(new URL('../../../.env.switch', import.meta.url), `SWITCH_AGENT_ID=${id}\nSWITCH_AGENT_KEY=${agent.api_key as string}\nMUNSHI_TEAMMATE_SECRET=${secret}\n`, { mode: 0o600 });
log('relay.registered');
