// Capabilities (decision 17, BLUEPRINT §8.13): what a shop uses. A shop starts from its type's pack (sign-up writes the
// pack's switches, members.ts), then an active owner switches any capability on or off. ops.capability_switch is
// append-only and the latest row per capability wins; who may switch, and the requirements both ways, are
// capability_guard's (CAP4), and the database audits every switch. Core reads the switches and the book guard never does,
// so switching off never blocks a reversal, and a switch never writes, deletes or hides a book row.
import type pg from 'pg';
import { CoreError } from './errors.ts';
import { platformLimits } from './platform.ts';
import { type Session, withTx } from './session.ts';

// The registry desks, watchers, screens and routes key into: exactly ref.capability's codes (CAP3).
export const CAPABILITIES = [
  'counter',
  'credit',
  'stock',
  'buying',
  'orders',
  'stitching',
  'bookings',
  'holds',
  'cart',
  'offers',
  'loyalty',
  'packages',
  'messaging',
  'campaigns',
  'staff',
  'salary',
  'gst',
  'site',
  'api',
  'ai',
  'variants',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

// A capability's state in the current tenant (RLS): its latest switch, and off with none.
const latest = (capability: string) =>
  `coalesce((select s.is_on from ops.capability_switch s where s.capability = ${capability} order by s.at desc, s.id desc limit 1), false)`;

// The capability check of a person's direct command (CAP2), inside the command's own transaction, after its body and
// before the commit. Each ref.command_capability row names a capability and its use: a `start` row refuses while its
// capability is off, and a `finish` row (completing or reversing an existing obligation) never refuses. A command with
// several `start` rows has a base, the row whose capability the others require (counter for sale.record, orders for
// order.confirm), and parts that only some inputs use (an udhaar amount needs credit). The base is checked here; a part
// is the command body's to check against its input. A command with no row is refused, so a missing row never frees it.
// Why after the body: every book row's audit entry takes the tenant's chain lock, which capability_guard takes for every
// switch, so by now a switch in flight has been waited for and is read here, and none lands before this commit. Taking
// that lock before the body instead would invert the order of a body's own locks (lockStock) and deadlock against an
// approved draft's execution. So a request invalid or unauthorised on its own gets that error first.
export async function refuseSwitchedOff(c: pg.PoolClient, command: string): Promise<void> {
  const { rows } = await c.query<{ n: number; off: string[] }>(
    `select count(*)::int as n,
            coalesce(array_agg(k.capability order by k.capability) filter (
              where k.use = 'start'
                and not exists (select 1 from ref.capability_requires r
                                  join ref.command_capability o on o.command = k.command and o.capability = r.requires and o.use = 'start'
                                 where r.capability = k.capability)
                and not ${latest('k.capability')}), '{}') as off
       from ref.command_capability k
      where k.command = $1`,
    [command],
  );
  const { n, off } = rows[0] as { n: number; off: string[] };
  if (n === 0) throw new CoreError('capability_off', { fields: ['command'] });
  if (off.length) throw new CoreError('capability_off', { fields: off });
}

// The parts of a command that only some inputs use (sale.record's udhaar, offer codes, points and package lines;
// order.confirm's stitching), each checked by the command body against its input, in its transaction: refused, naming
// every part that is off. A part is a start use, so a finish (a reversal, an existing obligation) never calls this.
export async function refuseParts(c: pg.PoolClient, parts: readonly Capability[]): Promise<void> {
  if (parts.length === 0) return;
  const { rows } = await c.query<{ off: string[] }>(
    `select coalesce(array_agg(p order by p) filter (where not ${latest('p')}), '{}') as off from unnest($1::text[]) as p`,
    [[...new Set(parts)]],
  );
  const off = (rows[0] as { off: string[] }).off;
  if (off.length) throw new CoreError('capability_off', { fields: off });
}

// Whether one capability's latest switch is on, in the current tenant (RLS), for a body that skips an optional effect
// (points earned while loyalty is off) instead of refusing.
export async function switchedOn(c: pg.PoolClient, capability: Capability): Promise<boolean> {
  const { rows } = await c.query<{ on: boolean }>(`select ${latest('$1')} as on`, [capability]);
  return (rows[0] as { on: boolean }).on;
}

// An item of this kind only while a switched-on capability admits it (ref.capability_item_kind: goods for the
// counter, stock or orders; services for bookings or stitching; packages for packages), refused otherwise.
export async function refuseItemKind(c: pg.PoolClient, kind: 'good' | 'service' | 'package'): Promise<void> {
  const { rows } = await c.query<{ ok: boolean }>(
    `select exists (select 1 from ref.capability_item_kind k where k.item_kind = $1 and ${latest('k.capability')}) as ok`,
    [kind],
  );
  if (!rows[0]?.ok) throw new CoreError('capability_off', { fields: ['kind'] });
}

// What a shop can use (§8.13), for a view inside the page's one transaction (withPage) and later the API: the latest
// switch is on and, for a capability marked needs_grant, the platform's approved grant is on too. That grant is
// platform.shop_config for ai (with the demo default for the sample shops, as platformLimits reads it) and for site, and
// the latest WhatsApp platform.channel_grant for messaging. The commands' check reads the switch alone.
export async function can(c: pg.PoolClient, session: Session, capability: Capability): Promise<boolean> {
  const { rows } = await c.query<{ ctx: string | null; is_on: boolean; needs_grant: boolean | null }>(
    `select nullif(current_setting('munshi.tenant_id', true), '') as ctx, ${latest('$1')} as is_on,
            (select needs_grant from ref.capability where code = $1) as needs_grant`,
    [capability],
  );
  const r = rows[0] as { ctx: string | null; is_on: boolean; needs_grant: boolean | null };
  // Under another tenant's context, or none, every switch would read as off for the wrong reason: refused instead.
  if (r.ctx !== session.tenantId) throw new CoreError('refused');
  if (r.needs_grant === null) throw new CoreError('invalid', { fields: ['capability'] });
  if (!r.is_on || !r.needs_grant) return r.is_on;
  if (capability === 'ai') return (await platformLimits(c, session.tenantId)).aiEnabled;
  if (capability === 'site') return (await platformLimits(c, session.tenantId)).siteVerified;
  if (capability === 'messaging') {
    const { rows: grant } = await c.query<{ granted: boolean }>(
      `select granted from platform.channel_grant where tenant_id = $1 and channel = 'whatsapp' order by effective_from desc, id desc limit 1`,
      [session.tenantId],
    );
    return grant[0]?.granted === true;
  }
  return false; // a grant core cannot read is no grant
}

// An owner switches a capability on or off (CAP4). The database refuses anyone but an active owner (MS007), a switch-on
// while a capability it requires is off and a switch-off while one that requires it is on (MS019), and audits the switch
// as capability.switch {capability, is_on} under the owner. One ops row, no book row; returns its id.
export async function switchCapability(pool: pg.Pool, session: Session, capability: Capability, on: boolean): Promise<string> {
  if (!(CAPABILITIES as readonly string[]).includes(capability)) throw new CoreError('invalid', { fields: ['capability'] });
  return withTx(pool, { kind: 'member', session }, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      'insert into ops.capability_switch (tenant_id, capability, is_on) values ($1, $2, $3) returning id::text as id',
      [session.tenantId, capability, on],
    );
    return (rows[0] as { id: string }).id;
  });
}
