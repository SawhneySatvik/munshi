// Tenants for the v2 gates, made through the real paths: the sign-up transaction as munshi_app with the new owner as the
// actor, then each row by the role and person whose job it is, so every guard the gates rely on has run. The probe
// command (probe.approve) is planted in ref as the owner: ref has no commands until the books files land (BP-DB-2).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { TestDb } from '../db.ts';
import { tx } from '../db.ts';

export type Tenant = { tenant: string; slug: string; owner: string; manager: string; staff: string; shop: string };
export type Filled = Tenant & {
  run: string;
  snapshot: string;
  jobsRun: string;
  watchSnapshot: string;
  finding: string;
  draft: string;
  decision: string;
  contact: string;
  document: string;
  text: string;
  answer: string;
  invite: string;
  login: string;
  subject: string;
  resetGrant: string;
  resetToken: string;
  session: string;
};

export const sha = (s: string | Buffer) => createHash('sha256').update(s).digest();

export const COLUMNS = [
  { n: 'item', k: 'text' },
  { n: 'amount', k: 'money' },
];
export const rowsOf = (amount: string) => [[{ k: 'text', t: 'Tea' }, { k: 'money', n: amount, c: 'INR' }]];

export async function plantProbeCommand(db: TestDb): Promise<void> {
  await db.admin.query(
    `set role munshi_owner;
     insert into ref.command (command, draft_only) values ('probe.approve', true) on conflict do nothing;
     insert into ref.command_authority (command, role) values ('probe.approve', 'owner'), ('probe.approve', 'manager') on conflict do nothing;
     reset role;`,
  );
}

export async function signUp(
  db: TestDb,
  slug: string,
  opts: { type?: 'kirana' | 'salon' | 'apparel'; dataClass?: 'synthetic' | 'showcase' | 'live'; sandbox?: boolean } = {},
): Promise<Tenant> {
  const tenant = randomUUID();
  const owner = randomUUID();
  const type = opts.type ?? 'kirana';
  const app = db.as('munshi_app');
  const shop = await tx(app, { tenant_id: tenant, actor_id: owner }, async (c) => {
    await c.query('insert into ops.tenant (tenant_id, name, business_type, data_class, sandbox) values ($1, $2, $3, $4, $5)', [
      tenant,
      `Shop ${slug}`,
      type,
      opts.dataClass ?? 'synthetic',
      opts.sandbox ?? false,
    ]);
    await c.query('insert into ops.tenant_directory (slug, tenant_id) values ($1, $2)', [slug, tenant]);
    await c.query(`insert into ops.member (tenant_id, id, display_name, role) values ($1, $2, 'Owner', 'owner')`, [tenant, owner]);
    const s = await c.query<{ id: string }>(`insert into ops.shop (tenant_id, name) values ($1, 'Main') returning id`, [tenant]);
    await c.query(
      `insert into ops.capability_switch (tenant_id, capability, is_on)
       select $1, p.capability, true from ref.pack_capability p where p.business_type = $2
        order by exists (select 1 from ref.capability_requires r where r.capability = p.capability), p.capability`,
      [tenant, type],
    );
    return s.rows[0]?.id as string;
  });
  const [manager, staff] = [randomUUID(), randomUUID()];
  await tx(app, { tenant_id: tenant, actor_id: owner }, async (c) => {
    await c.query(
      `insert into ops.member (tenant_id, id, display_name, role) values ($1, $2, 'Manager', 'manager'), ($1, $3, 'Staff', 'staff')`,
      [tenant, manager, staff],
    );
  });
  return { tenant, slug, owner, manager, staff, shop };
}

export async function invite(db: TestDb, t: Tenant, by: string, member: string): Promise<{ id: string; token: string }> {
  const token = randomBytes(32).toString('base64url');
  const id = await tx(db.as('munshi_app'), { tenant_id: t.tenant, actor_id: by }, async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into ops.member_invite (tenant_id, member_id, email, token_sha256, expires_at) values ($1, $2, 'p@example.invalid', $3, now())
       returning id`,
      [t.tenant, member, sha(token)],
    );
    return r.rows[0]?.id as string;
  });
  return { id, token };
}

// The invited member uses the invite and binds a login in one transaction (F4).
export async function bindLogin(db: TestDb, t: Tenant, member: string, inviteId: string, subject: string = randomUUID()): Promise<string> {
  return tx(db.as('munshi_app'), { tenant_id: t.tenant, actor_id: member }, async (c) => {
    await c.query('update ops.member_invite set used_at = now(), email = null, erased_at = now() where tenant_id = $1 and id = $2', [
      t.tenant,
      inviteId,
    ]);
    const r = await c.query<{ id: string }>(
      `insert into ops.login (provider, subject, tenant_id, member_id, invite_id) values ('password', $1, $2, $3, $4) returning id`,
      [subject, t.tenant, member, inviteId],
    );
    return r.rows[0]?.id as string;
  });
}

export async function mintDisplay(db: TestDb, t: Tenant, actor: string, amount = '1500'): Promise<string> {
  return tx(db.as('munshi_app'), { tenant_id: t.tenant, actor_id: actor }, async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into snap.snapshot (tenant_id, query_name, params, purpose, columns, rows, params_sha256, rows_sha256, row_count)
       values ($1, 'sale.day', '{}', 'display', $2, $3, '\\x00', '\\x00', 0) returning id`,
      [t.tenant, JSON.stringify(COLUMNS), JSON.stringify(rowsOf(amount))],
    );
    return r.rows[0]?.id as string;
  });
}

// One row in every tenant table of files 03–09, each written by the role and person whose job it is.
export async function fillTenant(db: TestDb, t: Tenant): Promise<Filled> {
  const app = db.as('munshi_app');
  const jobs = db.as('munshi_jobs');
  const ctx = (actor: string) => ({ tenant_id: t.tenant, actor_id: actor });
  const inv = await invite(db, t, t.owner, t.staff);
  const subject = randomUUID();
  const login = await bindLogin(db, t, t.staff, inv.id, subject);
  const resetToken = randomBytes(32).toString('base64url');
  const owned = await tx(app, ctx(t.owner), async (c) => {
    await c.query(
      `insert into ops.shop_hours (tenant_id, shop_id, weekday, opens, closes, closed, effective_from)
       values ($1, $2, 1, '09:00', '21:00', false, current_date)`,
      [t.tenant, t.shop],
    );
    const contact = (
      await c.query<{ id: string }>(`insert into ops.contact (tenant_id, name, phone_e164) values ($1, 'Asha', $2) returning id`, [
        t.tenant,
        `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      ])
    ).rows[0]?.id as string;
    const document = (
      await c.query<{ id: string }>(
        `insert into ops.document (tenant_id, kind, source, storage_key, sha256, mime, bytes)
         values ($1, 'photo', 'upload', $2, $3, 'image/jpeg', 1000) returning id`,
        [t.tenant, `t-${t.tenant}/photo/one.jpg`, sha(randomUUID())],
      )
    ).rows[0]?.id as string;
    await c.query(
      `insert into ops.idempotency (tenant_id, scope, key, command, request_sha256) values ($1, $2, 'key-0001', 'sale.record', $3)`,
      [t.tenant, `member:${t.owner}`, sha('request')],
    );
    const text = (
      await c.query<{ id: string }>(`insert into ops.message_text (tenant_id, body, author, body_sha256) values ($1, 'Namaste', 'member', '\\x00') returning id`, [
        t.tenant,
      ])
    ).rows[0]?.id as string;
    const run = (
      await c.query<{ id: string }>(`insert into ai.run (tenant_id, trigger, desk) values ($1, 'question', 'counter') returning id`, [t.tenant])
    ).rows[0]?.id as string;
    await c.query(`insert into ai.trace (tenant_id, run_id, seq, kind, label, ids) values ($1, $2, 1, 'route', 'counter', $3)`, [
      t.tenant,
      run,
      JSON.stringify([run]),
    ]);
    await c.query(`insert into ai.usage (tenant_id, day, role, calls) values ($1, current_date, 'router', 1)`, [t.tenant]);
    const resetGrant = (
      await c.query<{ id: string }>(
        `insert into ops.reset_grant (tenant_id, member_id, subject, token_sha256, issued_by, expires_at) values ($1, $2, $3, $4, $5, now()) returning id`,
        [t.tenant, t.staff, subject, sha(resetToken), t.owner],
      )
    ).rows[0]?.id as string;
    return { contact, document, text, run, resetGrant };
  });
  const snapshot = await mintDisplay(db, t, t.owner);
  const ref = { snapshotId: snapshot, row: 0, col: 'amount' };
  const { answer, draft } = await tx(app, ctx(t.owner), async (c) => {
    const answer = (
      await c.query<{ id: string }>(
        `insert into ai.answer (tenant_id, run_id, kind, text_id, refs, verdict) values ($1, $2, 'ask', $3, $4, 'answered') returning id`,
        [t.tenant, owned.run, owned.text, JSON.stringify([[ref]])],
      )
    ).rows[0]?.id as string;
    const draft = (
      await c.query<{ id: string }>(
        `insert into approval.draft (tenant_id, command, payload, based_on, payload_refs, source, created_txid)
         values ($1, 'probe.approve', '{"n": 1}', $2, $3, 'member', 0) returning id`,
        [t.tenant, JSON.stringify([ref]), JSON.stringify({ n: ref })],
      )
    ).rows[0]?.id as string;
    return { answer, draft };
  });
  const decision = await tx(app, ctx(t.owner), async (c) => {
    const d = await c.query<{ id: string }>(
      `insert into approval.decision (tenant_id, draft_id, verdict, decided_by, created_txid) values ($1, $2, 'approved', $3, 0) returning id`,
      [t.tenant, draft, t.owner],
    );
    return d.rows[0]?.id as string;
  });
  const session = await tx(app, ctx(t.staff), async (c) => {
    await c.query(`insert into ops.member_input (tenant_id, member_id, path, kind, num, currency) values ($1, $2, 'lines[0].price', 'money', 1500, 'INR')`, [
      t.tenant,
      t.staff,
    ]);
    const s = await c.query<{ id: string }>(
      `insert into ops.login_session (tenant_id, member_id, via, expires_at) values ($1, $2, 'demo', now() + interval '1 hour') returning id`,
      [t.tenant, t.staff],
    );
    return s.rows[0]?.id as string;
  });
  const { jobsRun, watchSnapshot, finding } = await tx(jobs, { tenant_id: t.tenant }, async (c) => {
    const jobsRun = (
      await c.query<{ id: string }>(`insert into ai.run (tenant_id, trigger, desk) values ($1, 'watcher', 'stock') returning id`, [t.tenant])
    ).rows[0]?.id as string;
    const watchSnapshot = (
      await c.query<{ id: string }>(
        `insert into snap.snapshot (tenant_id, query_name, params, purpose, columns, rows, params_sha256, rows_sha256, row_count)
         values ($1, 'watch.shrinkage', '{}', 'watch', $2, $3, '\\x00', '\\x00', 0) returning id`,
        [t.tenant, JSON.stringify(COLUMNS), JSON.stringify(rowsOf('2500'))],
      )
    ).rows[0]?.id as string;
    const finding = (
      await c.query<{ id: string }>(
        `insert into ai.finding (tenant_id, shop_id, desk, kind, dedupe_key, severity, snapshot_id, snapshot_row, row_sha256, impact_col,
                                 first_run_id, last_run_id)
         values ($1, $2, 'stock', 'shrinkage', 'shrinkage:tea', 'medium', $3, 0, '\\x00', 'amount', $4, $4) returning id`,
        [t.tenant, t.shop, watchSnapshot, jobsRun],
      )
    ).rows[0]?.id as string;
    await c.query(`insert into ai.brief (tenant_id, shop_id, business_date, run_id, ranked_snapshot_id) values ($1, $2, current_date, $3, $4)`, [
      t.tenant,
      t.shop,
      jobsRun,
      watchSnapshot,
    ]);
    const head = await c.query<{ seq: string; hash: Buffer }>('select seq, hash from audit.audit_log order by seq desc limit 1');
    await c.query('insert into audit.checkpoint (tenant_id, seq, hash) values ($1, $2, $3)', [t.tenant, head.rows[0]?.seq, head.rows[0]?.hash]);
    return { jobsRun, watchSnapshot, finding };
  });
  return {
    ...t,
    ...owned,
    snapshot,
    jobsRun,
    watchSnapshot,
    finding,
    draft,
    decision,
    answer,
    invite: inv.id,
    login,
    subject,
    resetToken,
    session,
  };
}
