// Red-proofs of the hosted seed's shop sites and the follow-up script (HOSTSITES: test/v2/core/seed/hosted-sites.test.ts). Each breaks one
// protection; the named test must then fail.
import type { Case } from './case.ts';

const FILE = 'test/v2/core/seed/hosted-sites.test.ts';
const WITHOUT = 'without origins the hosted seed publishes both sites, Elite’s included, and says they stay read-only';
const WITH = 'with origins each site lists its own and gets a fresh key the public API accepts; the keys file is 0600 and no line says a key';
const LATER = 'later, the follow-up script on the seeded database lists each site’s origin and issues keys the public API accepts';
const ARGS = 'the seed’s arguments: --confirm, then both https origins or neither; anything else is refused';
const ORIGINS = 'db/src/site-origins.ts';
const ts = (sabotage: string, test: string, file: string, from: string, to: string): Case => ({ sabotage, file: FILE, test, config: 'vitest.v2.config.ts', ts: { file, from, to } });

export const HOSTED_SITES_CASES: Case[] = [
  // Elite's site left unpublished by the hosted seed (as before: only `pnpm dev` published it)
  ts('v2-hosted-sites-elite-unpublished', WITHOUT, 'db/seed/hosted.ts', 'await publishShowcaseSite(app, owner, site)', "(site.stylists ? 'elite' : 'prabhave')"),
  // the site's origin never listed
  ts('v2-hosted-sites-no-origin', WITH, 'db/src/dev.ts', "await c.query('update ops.site set origins = array_append(origins, $2) where id = $1 and not ($2 = any(origins))', [site.id, listed]);", ''),
  // the follow-up script keys nothing: its sites found by a slug no tenant has
  ts('v2-hosted-sites-later-nothing', LATER, ORIGINS, "'select slug, tenant_id::text from ops.tenant_directory where slug = any($1::text[])'", "'select slug, tenant_id::text from ops.tenant_directory where slug = any($1::text[]) and false'"),
  // the keys file left readable by others
  ts('v2-hosted-sites-file-mode', WITH, ORIGINS, 'chmodSync(out, 0o600);', 'chmodSync(out, 0o644);'),
  // a key said on the terminal
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of site-origins.ts, not a template
  ts('v2-hosted-sites-key-said', WITH, ORIGINS, 'say(`${k.slug} lists ${k.origin}`)', 'say(`${k.slug} lists ${k.origin} ${k.key}`)'),
  // an http origin accepted
  ts('v2-hosted-sites-http', ARGS, ORIGINS, "u.protocol !== 'https:' || !bare || !/^https:\\/\\/[a-z0-9.-]{1,200}(:[0-9]{1,5})?$/.test(u.origin)", '!bare'),
  // one origin without the other accepted
  ts('v2-hosted-sites-one-origin', ARGS, ORIGINS, 'if (given.length !== SITE_SLUGS.length) throw', 'if (false) throw'),
];
