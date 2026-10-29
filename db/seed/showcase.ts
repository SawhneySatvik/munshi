// The two showcase tenants, Elite (db/seed/elite.ts) and Prabhave (db/seed/prabhave.ts), built for one as_of (by default
// tomorrow, so the whole of Elite's booked window lies ahead of the clock), and their sites verified the only way a site
// is verified: a site_verify change per shop, proposed and approved by a platform operator (VERIFY1). The operator is
// seeded here with `pnpm platform:operator`'s own function, under secrets the caller passes or, by default, ones made for
// this run and never kept or printed (so that operator is the seed's alone: nobody can sign in as it afterwards).
import { randomBytes } from 'node:crypto';
import { addDays, approveChange, businessDate, changeDiff, signInOperator, verifySite, withOperator } from '@munshi/core';
import type pg from 'pg';
import { hotp, stepAt } from '../../packages/core/src/platform-totp.ts';
import { seedOperator } from '../src/platform-operator.ts';
import { type Elite, ELITE_PLANTS, type ElitePlant, seedElite } from './elite.ts';
import { type Prabhave, PRABHAVE_PLANTS, type PrabhavePlant, seedPrabhave } from './prabhave.ts';

export type ShowcasePlant = ElitePlant | PrabhavePlant;
export const SHOWCASE_PLANTS: ShowcasePlant[] = [...ELITE_PLANTS, ...PRABHAVE_PLANTS];
export const SHOWCASE_OPERATOR = 'Showcase seed';

export type ShowcasePools = { app: pg.Pool; pub: pg.Pool; platform: pg.Pool };
export type ShowcaseOpts = {
  asOf?: string;
  omit?: ShowcasePlant[];
  // false: leave both sites unverified (a database whose first operator already exists cannot seed another).
  verify?: boolean;
  secrets?: { identitySecret: string; platformSecret: string };
};
export type Showcase = { asOf: string; elite: Elite; prabhave: Prabhave; operatorId: string | null; verifications: string[] };

/**
 * `pools`: munshi_app (the seed), munshi_public (the site's asks and carts), munshi_platform (the operator).
 * `owner`: a connection that may SET ROLE munshi_owner: it provisions both tenants, publishes Prabhave's release and
 * seeds the operator.
 */
export async function seedShowcase(pools: ShowcasePools, owner: pg.ClientBase, opts: ShowcaseOpts = {}): Promise<Showcase> {
  const asOf = opts.asOf ?? addDays(businessDate(new Date(), 'Asia/Kolkata'), 1);
  const omit = opts.omit ?? [];
  const elite = await seedElite(pools.app, owner, { asOf, omit: omit.filter((p): p is ElitePlant => (ELITE_PLANTS as string[]).includes(p)) });
  const prabhave = await seedPrabhave(pools.app, pools.pub, owner, { asOf, omit: omit.filter((p): p is PrabhavePlant => (PRABHAVE_PLANTS as string[]).includes(p)) });
  if (opts.verify === false) return { asOf, elite, prabhave, operatorId: null, verifications: [] };

  const secrets = opts.secrets ?? { identitySecret: randomBytes(32).toString('hex'), platformSecret: randomBytes(32).toString('hex') };
  const op = await seedOperator(
    owner,
    { email: 'showcase-seed@example.invalid', password: randomBytes(24).toString('hex'), displayName: SHOWCASE_OPERATOR },
    secrets,
  );
  const session = await signInOperator(pools.platform, op.subject, hotp(op.totpSecret, stepAt(Date.now())), secrets.platformSecret);
  if (!session) throw new Error('seed: the showcase operator could not sign in');
  const verifications: string[] = [];
  for (const tenantId of [elite.tenantId, prabhave.tenantId]) {
    const { id } = await withOperator(pools.platform, session, (c) => verifySite(c, tenantId));
    const diff = await withOperator(pools.platform, session, (c) => changeDiff(c, id));
    await withOperator(pools.platform, session, (c) => approveChange(c, id, { digest: diff.digest }));
    verifications.push(id);
  }
  return { asOf, elite, prabhave, operatorId: op.operatorId, verifications };
}
