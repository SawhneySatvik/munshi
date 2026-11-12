// Red-proofs of the read-only integration feed (apps/web/test/integration-feed.test.ts: the route, and core's
// integration-feed.ts) and of vercel-env's integration key and PUBLIC_ names (test/v2/deploy/vercel-env.test.ts,
// VERCEL-ENV3). Each breaks one protection; the named test must then fail.
import type { Case } from './case.ts';

const ROUTE = 'apps/web/app/api/integrations/v1/feed/route.ts';
const FEED = 'packages/core/src/integration-feed.ts';
const FEED1 = 'FEED1 the route admits only the integration secret, and refuses everything else with a bare 404';
const FEED2 = 'FEED2 links carry their state in their id, and every amount is a stored cell or row with its source';
const FEED3 = 'FEED3 reading the feed writes nothing, and its transaction refuses a write';
const FEED4 = "FEED4 a real shop's books are never served";
const ENV3 = 'VERCEL-ENV3 the integration key goes from .env when set, and a PUBLIC_ name is added as a config variable';

const web = (test: string, sabotage: string, file: string, from: string, to: string): Case => ({
  sabotage,
  dir: 'apps/web',
  config: 'vitest.config.ts',
  file: 'test/integration-feed.test.ts',
  test,
  ts: { file, from, to },
});
const env = (sabotage: string, from: string, to: string): Case => ({
  sabotage,
  file: 'test/v2/deploy/vercel-env.test.ts',
  test: ENV3,
  config: 'vitest.v2.config.ts',
  ts: { file: 'deploy/vercel-env.ts', from, to },
});

export const INTEGRATIONS_CASES: Case[] = [
  // any key admitted
  web(FEED1, 'v2-feed-any-key', ROUTE, 'return secret !== "" && timingSafeEqual(', 'return true || timingSafeEqual('),
  // a link's id without its state: a paid link would never trigger again
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text to break, not a template
  web(FEED2, 'v2-feed-id-stateless', FEED, 'id: `${l.id}:${l.state}`,', 'id: l.id,'),
  // the feed's transaction left writable
  web(FEED3, 'v2-feed-writable', FEED, "await c.query('set transaction read only');", "await c.query('select 1');"),
  // a real shop's books served
  web(FEED4, 'v2-feed-live-served', FEED, "if (!shop || shop.data_class === 'live') return null;", 'if (!shop) return null;'),
  // PUBLIC_DATABASE_URL added as a secret, which Vercel refuses
  env('v2-vercel-env-public-secret', "...(/^PUBLIC_/.test(name) ? ['--yes', '--type', 'config'] : [])", '...([] as string[])'),
  // the integration key left behind
  env('v2-vercel-env-integration-dropped', 'for (const name of INTEGRATION_KEYS) if (local[name])', 'for (const name of INTEGRATION_KEYS) if (false)'),
];
