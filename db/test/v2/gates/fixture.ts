// Tenants for the v2 gates, made through the real paths: the sign-up transaction as munshi_app with the new owner as the
// actor, then each row by the role and person whose job it is, so every guard the gates rely on has run. The probe
// command (probe.approve) is planted in ref as the owner, so a draft can name a command that writes nothing real.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
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
export async function fillTenant(db: TestDb, t: Tenant): Promise<Filled & Books> {
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
  const filled = {
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
  return { ...filled, ...(await fillBooks(db, filled)) };
}

export type Books = {
  good: string;
  service: string;
  goodPrice: string;
  customer: string;
  customerContact: string;
  supplier: string;
  staffRow: string;
  terms: string;
  pattern: string;
  sale: string;
  purchase: string;
  registration: string;
  offer: string;
  plan: string;
  pack: string;
  counterSale: string;
  holding: string;
  inbound: string;
  reorder: string;
  request: string;
  order: string;
  site: string;
  look: string;
  booking: string;
  holdToken: string;
  reservation: string;
};

// The next Monday in the shop's zone (Asia/Kolkata), at least a day ahead: its roster row and shop hours are on weekday 1.
export const BOOKING_DAY = `((now() at time zone 'Asia/Kolkata')::date + (8 - extract(isodow from (now() at time zone 'Asia/Kolkata')::date)::int))`;
export const slot = (from: string, to: string) =>
  `tstzrange((${BOOKING_DAY} + time '${from}') at time zone 'Asia/Kolkata', (${BOOKING_DAY} + time '${to}') at time zone 'Asia/Kolkata', '[)')`;

// One row in every table of files 10–21, each through its own command or role: the catalogue, parties and consent, the
// roster, leave, a holiday, attendance, an advance and an approved salary run, a sale, a purchase and a settlement with
// their journal, photo evidence, offers, loyalty, a package and a tax invoice, the inbox, a reorder and a campaign, a
// grid batch, an order with its advance and a measurement, a published site, a staff profile, and the public's request, booking and reservation.
export async function fillBooks(db: TestDb, f: Tenant & { run: string; snapshot: string }): Promise<Books> {
  const app = db.as('munshi_app');
  const cmd = <T>(actor: string, command: string, fn: (c: pg.PoolClient) => Promise<T>) =>
    tx(app, { tenant_id: f.tenant, actor_id: actor, command }, fn);
  const id = async (c: pg.PoolClient, sql: string, params: unknown[]) => (await c.query<{ id: string }>(sql, params)).rows[0]?.id as string;
  const phone = () => `+9197${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const [customerContact, supplierContact, staffContact] = await tx(app, { tenant_id: f.tenant, actor_id: f.owner }, async (c) => [
    await id(c, `insert into ops.contact (tenant_id, name, phone_e164) values ($1, 'Customer', $2) returning id`, [f.tenant, phone()]),
    await id(c, `insert into ops.contact (tenant_id, name, phone_e164) values ($1, 'Supplier', $2) returning id`, [f.tenant, phone()]),
    await id(c, `insert into ops.contact (tenant_id, name, phone_e164) values ($1, 'Stylist', $2) returning id`, [f.tenant, phone()]),
  ]);
  const { good, service } = await cmd(f.owner, 'item.create', async (c) => {
    const good = await id(c, `insert into books.item (tenant_id, kind, unit) values ($1, 'good', 'pack') returning id`, [f.tenant]);
    await c.query(`insert into books.item_revision (tenant_id, item_id, name, effective_from) values ($1, $2, 'Tea 250 g', now())`, [f.tenant, good]);
    const service = await id(c, `insert into books.item (tenant_id, kind, unit) values ($1, 'service', 'session') returning id`, [f.tenant]);
    await c.query(`insert into books.item_revision (tenant_id, item_id, name, duration_min, effective_from) values ($1, $2, 'Haircut', 30, now())`, [
      f.tenant,
      service,
    ]);
    return { good, service };
  });
  const goodPrice = await cmd(f.owner, 'price.set', async (c) => {
    await c.query(`insert into books.price (tenant_id, item_id, amount_minor, currency, effective_from) values ($1, $2, 40000, 'INR', now())`, [f.tenant, service]);
    return id(c, `insert into books.price (tenant_id, item_id, amount_minor, currency, effective_from) values ($1, $2, 25000, 'INR', now()) returning id`, [
      f.tenant,
      good,
    ]);
  });
  await cmd(f.owner, 'item.alias', (c) => c.query(`insert into books.item_alias (tenant_id, item_id, alias) values ($1, $2, 'chai patti')`, [f.tenant, good]));
  const customer = await cmd(f.owner, 'customer.create', async (c) => {
    const customer = await id(c, 'insert into books.customer (tenant_id) values ($1) returning id', [f.tenant]);
    await c.query(`insert into books.customer_terms (tenant_id, customer_id, credit_limit_minor, currency, effective_from) values ($1, $2, 500000, 'INR', now())`, [
      f.tenant,
      customer,
    ]);
    await c.query('insert into books.party_contact (tenant_id, customer_id, contact_id, effective_from) values ($1, $2, $3, now())', [f.tenant, customer, customerContact]);
    return customer;
  });
  const supplier = await cmd(f.owner, 'supplier.create', async (c) => {
    const supplier = await id(c, 'insert into books.supplier (tenant_id, is_simulated) values ($1, true) returning id', [f.tenant]);
    await c.query('insert into books.party_contact (tenant_id, supplier_id, contact_id, effective_from) values ($1, $2, $3, now())', [f.tenant, supplier, supplierContact]);
    return supplier;
  });
  const { staffRow, terms } = await cmd(f.owner, 'staff.create', async (c) => {
    const staffRow = await id(c, 'insert into books.staff (tenant_id, member_id) values ($1, $2) returning id', [f.tenant, f.staff]);
    const terms = await id(
      c,
      `insert into books.staff_terms (tenant_id, staff_id, shop_id, title, pay_kind, pay_minor, currency, effective_from)
       values ($1, $2, $3, 'Stylist', 'monthly', 1500000, 'INR', current_date - 30) returning id`,
      [f.tenant, staffRow, f.shop],
    );
    await c.query('insert into books.party_contact (tenant_id, staff_id, contact_id, effective_from) values ($1, $2, $3, now())', [f.tenant, staffRow, staffContact]);
    return { staffRow, terms };
  });
  await cmd(f.staff, 'consent.record', (c) =>
    c.query(
      `insert into books.customer_consent (tenant_id, customer_id, contact_id, channel, purpose, granted, source, notice_version, at)
       values ($1, $2, $3, 'whatsapp', 'service', true, 'in_person', 'v1', now())`,
      [f.tenant, customer, customerContact],
    ),
  );
  const pattern = await cmd(f.owner, 'shift.pattern.set', (c) =>
    id(
      c,
      `insert into books.shift_pattern (tenant_id, staff_id, shop_id, weekday, starts, ends, effective_from)
       values ($1, $2, $3, 1, '09:00', '21:00', current_date - 7) returning id`,
      [f.tenant, staffRow, f.shop],
    ),
  );
  await cmd(f.owner, 'shift.change', (c) =>
    c.query(`insert into books.shift_change (tenant_id, staff_id, day, shop_id, starts, ends) values ($1, $2, current_date + 30, $3, '10:00', '18:00')`, [
      f.tenant,
      staffRow,
      f.shop,
    ]),
  );
  await cmd(f.owner, 'leave.record', (c) =>
    c.query(`insert into books.leave (tenant_id, staff_id, kind, first_day, last_day) values ($1, $2, 'unpaid', current_date + 60, current_date + 61)`, [
      f.tenant,
      staffRow,
    ]),
  );
  await cmd(f.owner, 'holiday.set', (c) =>
    c.query(`insert into books.holiday (tenant_id, shop_id, day, name_key) values ($1, $2, current_date + 90, 'diwali')`, [f.tenant, f.shop]),
  );
  await cmd(f.staff, 'attendance.mark', (c) =>
    c.query(`insert into books.attendance (tenant_id, staff_id, shop_id, day, status, marked_by_role) values ($1, $2, $3, current_date, 'present', 'owner')`, [
      f.tenant,
      staffRow,
      f.shop,
    ]),
  );
  const journal = async (c: pg.PoolClient, memo: string, lines: [string, number][], source?: [string, string]) => {
    const entry = await id(c, `insert into books.journal_entry (tenant_id, entry_date, memo_code, source_rel, source_id) values ($1, current_date, $2, $3, $4) returning id`, [
      f.tenant,
      memo,
      source?.[0] ?? null,
      source?.[1] ?? null,
    ]);
    for (const [account, amount] of lines) {
      await c.query(`insert into books.journal_line (tenant_id, entry_id, account, amount_minor, currency) values ($1, $2, $3, $4, 'INR')`, [f.tenant, entry, account, amount]);
    }
  };
  await cmd(f.owner, 'advance.give', async (c) => {
    const advance = await id(c, `insert into books.advance (tenant_id, staff_id, amount_minor, currency, given_on) values ($1, $2, 50000, 'INR', current_date) returning id`, [
      f.tenant,
      staffRow,
    ]);
    await c.query(`insert into books.payment (tenant_id, direction, method, amount_minor, currency, staff_id, paid_at) values ($1, 'out', 'cash', 50000, 'INR', $2, now())`, [
      f.tenant,
      staffRow,
    ]);
    await journal(c, 'advance_given', [['staff_advance', 50000], ['cash', -50000]], ['books.advance', advance]);
  });
  // salary.run is draft-only: proposed, then approved by the owner a transaction later and written under the decision.
  const salaryDraft = await tx(app, { tenant_id: f.tenant, actor_id: f.owner }, (c) =>
    id(c, `insert into approval.draft (tenant_id, command, payload, based_on, source, created_txid) values ($1, 'salary.run', '{}', $2, 'member', 0) returning id`, [
      f.tenant,
      JSON.stringify([{ snapshotId: f.snapshot, row: 0, col: 'amount' }]),
    ]),
  );
  await tx(app, { tenant_id: f.tenant, actor_id: f.owner }, async (c) => {
    const decision = await id(c, `insert into approval.decision (tenant_id, draft_id, verdict, decided_by, created_txid) values ($1, $2, 'approved', $3, 0) returning id`, [
      f.tenant,
      salaryDraft,
      f.owner,
    ]);
    await c.query(`select set_config('munshi.decision_id', $1, true)`, [decision]);
    const run = await id(
      c,
      `insert into books.salary_run (tenant_id, period_start, period_end) values ($1, date_trunc('month', now())::date, (date_trunc('month', now()) + interval '1 month - 1 day')::date) returning id`,
      [f.tenant],
    );
    await c.query(
      `insert into books.salary_line (tenant_id, run_id, staff_id, terms_id, pay_kind, pay_minor, days_milli, gross_minor, advance_recovered_minor, net_minor, currency)
       values ($1, $2, $3, $4, 'monthly', 1500000, 30000, 1500000, 50000, 1450000, 'INR')`,
      [f.tenant, run, staffRow, terms],
    );
    await journal(c, 'salary_run', [['wages_expense', 1500000], ['wages_payable', -1450000], ['staff_advance', -50000]], ['books.salary_run', run]);
    await c.query(`update approval.draft set status = 'executed' where tenant_id = $1 and id = $2`, [f.tenant, salaryDraft]);
  });
  const sale = await cmd(f.staff, 'sale.record', async (c) => {
    const sale = await id(c, `insert into books.sale (tenant_id, shop_id, sold_at, customer_id, total_minor, currency) values ($1, $2, now(), $3, 25000, 'INR') returning id`, [
      f.tenant,
      f.shop,
      customer,
    ]);
    await c.query(
      `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, currency)
       values ($1, $2, 1, $3, 'good', $4, 1000, 25000, 25000, 'INR')`,
      [f.tenant, sale, good, goodPrice],
    );
    await c.query(`insert into books.stock_move (tenant_id, item_id, qty_milli, kind, source_rel, source_id, at) values ($1, $2, -1000, 'sale', 'books.sale', $3, now())`, [
      f.tenant,
      good,
      sale,
    ]);
    await c.query(`insert into books.payment (tenant_id, direction, method, amount_minor, currency, customer_id, sale_id, paid_at) values ($1, 'in', 'cash', 15000, 'INR', $2, $3, now())`, [
      f.tenant,
      customer,
      sale,
    ]);
    await c.query(`insert into books.credit_entry (tenant_id, customer_id, amount_minor, currency, sale_id, at) values ($1, $2, 10000, 'INR', $3, now())`, [f.tenant, customer, sale]);
    await journal(c, 'sale', [['cash', 15000], ['receivable', 10000], ['sales', -25000]], ['books.sale', sale]);
    return sale;
  });
  const billLine = await tx(app, { tenant_id: f.tenant, actor_id: f.owner }, async (c) => {
    await c.query(
      `insert into ops.shelf_count (tenant_id, run_id, item_id, photo_sha256, phrase, model, raw, raw_sha256, matches)
       values ($1, $2, $3, $4, 'Tea 250 g', 'model-x', 'none', $5, 0)`,
      [f.tenant, f.run, good, sha(randomUUID()), sha('none')],
    );
    const read = await id(c, `insert into ops.bill_read (tenant_id, run_id, supplier_id, photo_sha256, model, bill_no, bill_date, created_txid) values ($1, $2, $3, $4, 'model-x', 'B-1', current_date, 0) returning id`, [
      f.tenant,
      f.run,
      supplier,
      sha(randomUUID()),
    ]);
    const billLine = await id(
      c,
      `insert into ops.bill_line (tenant_id, bill_read_id, line_no, item_text, item_id, qty_milli, unit_cost_minor, qty_box, cost_box)
       values ($1, $2, 1, 'Tea 250 g', $3, 2000, 25000, '{10,10,20,20}', '{30,10,40,20}') returning id`,
      [f.tenant, read, good],
    );
    return billLine;
  });
  const purchaseId = await cmd(f.owner, 'purchase.record', async (c) => {
    const p = await id(c, `insert into books.purchase (tenant_id, supplier_id, bill_no, bill_date, total_minor, currency) values ($1, $2, 'B-1', current_date, 50000, 'INR') returning id`, [
      f.tenant,
      supplier,
    ]);
    await c.query(
      `insert into books.purchase_line (tenant_id, purchase_id, line_no, item_id, qty_milli, unit_cost_minor, currency, bill_line_id) values ($1, $2, 1, $3, 2000, 25000, 'INR', $4)`,
      [f.tenant, p, good, billLine],
    );
    await c.query(`insert into books.stock_move (tenant_id, item_id, qty_milli, kind, source_rel, source_id, at) values ($1, $2, 2000, 'purchase', 'books.purchase', $3, now())`, [
      f.tenant,
      good,
      p,
    ]);
    await journal(c, 'purchase', [['inventory', 50000], ['payable', -50000]], ['books.purchase', p]);
    return p;
  });
  await cmd(f.owner, 'settlement.record', async (c) => {
    const s = await id(c, `insert into books.settlement (tenant_id, channel, business_date, amount_minor, currency, received_on) values ($1, 'upi', current_date, 15000, 'INR', current_date) returning id`, [
      f.tenant,
    ]);
    await journal(c, 'settlement', [['bank', 15000], ['upi_clearing', -15000]], ['books.settlement', s]);
  });
  // 16–18: the shop invoices (a state and a series) under a regular registration; a loyalty rule; an item offer with a
  // code and caps, and an ended one; a five-session package plan. Then a counter sale to the named customer with the
  // offer's discount, the points it earns, the package sold and held, its tax invoice and journal; then one redemption.
  await tx(app, { tenant_id: f.tenant, actor_id: f.owner }, (c) =>
    c.query(`update ops.shop set state_code = '07', invoice_series = 'KN' where tenant_id = $1 and id = $2`, [f.tenant, f.shop]),
  );
  const registration = await cmd(f.owner, 'tax.registration.set', (c) =>
    id(c, `insert into books.tax_registration (tenant_id, scheme, gstin, state_code, effective_from) values ($1, 'regular', '07ABCDE1234F1Z5', '07', current_date - 1) returning id`, [
      f.tenant,
    ]),
  );
  await cmd(f.owner, 'loyalty.rule.set', (c) =>
    c.query(`insert into books.loyalty_rule (tenant_id, earn_per_100, point_value_minor, currency, min_redeem, effective_from) values ($1, 100, 100, 'INR', 10, now())`, [
      f.tenant,
    ]),
  );
  const offer = await cmd(f.owner, 'offer.create', async (c) => {
    const offer = await id(
      c,
      `insert into books.offer (tenant_id, name, kind, percent_bp, scope, code, max_redemptions, per_customer_limit, starts_at, ends_at)
       values ($1, 'Tea week', 'percent_off', 1000, 'items', 'TEA10', 100, 5, now() - interval '1 day', now() + interval '30 days') returning id`,
      [f.tenant],
    );
    await c.query('insert into books.offer_item (tenant_id, offer_id, item_id) values ($1, $2, $3)', [f.tenant, offer, good]);
    return offer;
  });
  const endedOffer = await cmd(f.owner, 'offer.create', (c) =>
    id(
      c,
      `insert into books.offer (tenant_id, name, kind, amount_off_minor, currency, scope, starts_at, ends_at)
       values ($1, 'Fifty off', 'amount_off', 5000, 'INR', 'all', now() - interval '1 day', now() + interval '30 days') returning id`,
      [f.tenant],
    ),
  );
  await cmd(f.owner, 'offer.end', (c) =>
    c.query(`insert into books.offer_end (tenant_id, offer_id, ended_at, reason) values ($1, $2, now(), 'not_relevant')`, [f.tenant, endedOffer]),
  );
  const { pack, plan } = await cmd(f.owner, 'package.plan.create', async (c) => {
    const pack = await id(c, `insert into books.item (tenant_id, kind, unit) values ($1, 'package', 'piece') returning id`, [f.tenant]);
    await c.query(`insert into books.item_revision (tenant_id, item_id, name, effective_from) values ($1, $2, 'Five haircuts', now())`, [f.tenant, pack]);
    const price = await id(c, `insert into books.price (tenant_id, item_id, amount_minor, currency, effective_from) values ($1, $2, 180000, 'INR', now()) returning id`, [
      f.tenant,
      pack,
    ]);
    const plan = await id(c, `insert into books.package_plan (tenant_id, item_id, kind, validity_days) values ($1, $2, 'sessions', 180) returning id`, [f.tenant, pack]);
    await c.query(`insert into books.package_plan_line (tenant_id, plan_id, line_no, item_id, sessions) values ($1, $2, 1, $3, 5)`, [f.tenant, plan, service]);
    return { pack: { item: pack, price }, plan };
  });
  // Tea at 5% inside its price, taxed on the price less its 2500 discount (D-052): 22500, taxable round(22500 × 10000 ÷
  // 10500) = 21429, tax 1071 = 535 + 536; the package untaxed. The invoice totals the receipt, 202500.
  const { counterSale, holding } = await cmd(f.staff, 'sale.record', async (c) => {
    const s = await id(c, `insert into books.sale (tenant_id, shop_id, sold_at, customer_id, total_minor, currency) values ($1, $2, now(), $3, 202500, 'INR') returning id`, [
      f.tenant,
      f.shop,
      customer,
    ]);
    const tea = await id(
      c,
      `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, tax_class, tax_rate_bp, tax_minor, currency)
       values ($1, $2, 1, $3, 'good', $4, 1000, 25000, 25000, 'general_5', 500, 1071, 'INR') returning id`,
      [f.tenant, s, good, goodPrice],
    );
    const packLine = await id(
      c,
      `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, currency)
       values ($1, $2, 2, $3, 'package', $4, 1000, 180000, 180000, 'INR') returning id`,
      [f.tenant, s, pack.item, pack.price],
    );
    await c.query(`insert into books.sale_discount (tenant_id, sale_id, line_no, source, offer_id, amount_minor, currency) values ($1, $2, 1, 'offer', $3, 2500, 'INR')`, [
      f.tenant,
      s,
      offer,
    ]);
    await c.query(`insert into books.loyalty_entry (tenant_id, customer_id, kind, points, seq, balance_after, sale_id, at) values ($1, $2, 'earned', 2025, 0, 0, $3, now())`, [
      f.tenant,
      customer,
      s,
    ]);
    const holding = await id(
      c,
      `insert into books.package_holding (tenant_id, customer_id, plan_id, sale_id, starts_on, expires_on, liability_minor, currency)
       values ($1, $2, $3, $4, current_date, current_date + 180, 180000, 'INR') returning id`,
      [f.tenant, customer, plan, s],
    );
    await c.query(
      `insert into books.package_entry (tenant_id, holding_id, shop_id, item_id, kind, sessions, value_minor, currency, seq, value_after, at)
       values ($1, $2, $3, $4, 'sold', 5, 180000, 'INR', 0, 0, now())`,
      [f.tenant, holding, f.shop, service],
    );
    await c.query(`insert into books.stock_move (tenant_id, item_id, qty_milli, kind, source_rel, source_id, at) values ($1, $2, -1000, 'sale', 'books.sale', $3, now())`, [
      f.tenant,
      good,
      s,
    ]);
    await c.query(`insert into books.payment (tenant_id, direction, method, amount_minor, currency, customer_id, sale_id, paid_at) values ($1, 'in', 'cash', 202500, 'INR', $2, $3, now())`, [
      f.tenant,
      customer,
      s,
    ]);
    const invoice = await id(
      c,
      `insert into books.invoice (tenant_id, sale_id, shop_id, kind, taxable_minor, cgst_minor, sgst_minor, total_minor, currency)
       values ($1, $2, $3, 'tax_invoice', 201429, 535, 536, 202500, 'INR') returning id`,
      [f.tenant, s, f.shop],
    );
    await c.query(
      `insert into books.invoice_line (tenant_id, invoice_id, line_no, sale_line_id, description, hsn_sac, qty_milli, discount_minor, taxable_minor, rate_bp, cgst_minor,
                                       sgst_minor, total_minor)
       values ($1, $2, 1, $3, 'Tea 250 g', '0902', 1000, 2500, 21429, 500, 535, 536, 22500), ($1, $2, 2, $4, 'Five haircuts', null, 1000, 0, 180000, 0, 0, 0, 180000)`,
      [f.tenant, invoice, tea, packLine],
    );
    await journal(
      c,
      'sale',
      [['cash', 202500], ['sales_discount', 2500], ['sales', -23929], ['gst_output_cgst', -535], ['gst_output_sgst', -536], ['package_liability', -180000]],
      ['books.sale', s],
    );
    return { counterSale: s, holding };
  });
  await cmd(f.staff, 'package.redeem', async (c) => {
    const e = await id(
      c,
      `insert into books.package_entry (tenant_id, holding_id, shop_id, item_id, kind, sessions, value_minor, currency, seq, value_after, at)
       values ($1, $2, $3, $4, 'redeemed', -1, -36000, 'INR', 0, 0, now()) returning id`,
      [f.tenant, holding, f.shop, service],
    );
    await journal(c, 'package_redeemed', [['package_liability', 36000], ['sales', -36000]], ['books.package_entry', e]);
  });
  // 19: an inbox message from the customer (the webhook, no actor) and a figure extracted from it by a member's run; a
  // reorder to the supplier with its text and derived delivery (recorded); a campaign being composed; a test recipient
  // and its route, planted (listing one needs an operator's WhatsApp grant, CH1's own tests make one).
  const inbound = randomUUID();
  await tx(db.as('munshi_public'), { tenant_id: f.tenant }, (c) =>
    c.query(
      `insert into ops.inbound_message (tenant_id, id, provider_message_id, from_address, kind, text, received_at) values ($1, $2, $3, '919700000001', 'text', 'Need 2 packs of tea', now())`,
      [f.tenant, inbound, `wamid.${randomUUID()}`],
    ),
  );
  await tx(app, { tenant_id: f.tenant, actor_id: f.owner }, (c) =>
    c.query(
      `insert into ops.inbound_extract (tenant_id, message_id, run_id, field, num, item_id, span_start, span_end, span_sha256, parsed_as)
       values ($1, $2, $3, 'quantity', 2000, null, 5, 6, $4, 'digits')`,
      [f.tenant, inbound, f.run, sha('2')],
    ),
  );
  const reorderBody = 'Please send 10 packs of Tea 250 g';
  const reorder = await cmd(f.owner, 'reorder.place', async (c) => {
    const text = await id(c, `insert into ops.message_text (tenant_id, body, author, body_sha256) values ($1, $2, 'template', $3) returning id`, [
      f.tenant,
      reorderBody,
      sha(reorderBody),
    ]);
    return id(
      c,
      `insert into books.outbound_message (tenant_id, channel, recipient_kind, recipient_id, template_code, text_id, body_sha256) values ($1, 'whatsapp', 'supplier', $2, 'reorder', $3, $4) returning id`,
      [f.tenant, supplier, text, sha(reorderBody)],
    );
  });
  await tx(app, { tenant_id: f.tenant, actor_id: f.owner }, (c) =>
    c.query(`insert into ops.campaign (tenant_id, name, channel, segment, segment_days) values ($1, 'Come back', 'whatsapp', 'lapsed_regulars', 60)`, [f.tenant]),
  );
  const recipient = randomUUID();
  const planter = await db.admin.connect();
  try {
    await planter.query('begin');
    await planter.query('set local session_replication_role = replica');
    await planter.query(
      `insert into ops.channel_recipient (tenant_id, id, channel, contact_id, added_by, created_txid) values ($1, $2, 'whatsapp', $3, $4, txid_current())`,
      [f.tenant, recipient, customerContact, f.owner],
    );
    await planter.query('insert into ops.phone_route (phone_hmac, tenant_id, recipient_id) values ($1, $2, $3)', [sha(randomUUID()), f.tenant, recipient]);
    await planter.query('commit');
  } finally {
    planter.release();
  }
  // 20: a grid batch opened on the display snapshot, with a price change and a new item.
  await tx(app, { tenant_id: f.tenant, actor_id: f.owner }, async (c) => {
    const batch = await id(c, `insert into ops.grid_batch (tenant_id, base_snapshot_id, source, created_txid) values ($1, $2, 'typed', 0) returning id`, [f.tenant, f.snapshot]);
    await c.query(
      `insert into ops.grid_change (tenant_id, batch_id, line_no, kind, item_id, amount_minor, currency) values ($1, $2, 1, 'price', $3, 26000, 'INR')`,
      [f.tenant, batch, good],
    );
    await c.query(
      `insert into ops.grid_change (tenant_id, batch_id, line_no, kind, add_key, amount_minor, currency, new_item) values ($1, $2, 2, 'new_item', 'masala', 9000, 'INR', '{"name": "Masala 100 g"}')`,
      [f.tenant, batch],
    );
  });
  // The site, published by the owner role as the reset does off live; the art the look names.
  const { site, look } = await tx(app, { tenant_id: f.tenant, actor_id: f.owner }, async (c) => {
    await c.query(`insert into ops.capability_switch (tenant_id, capability, is_on) values ($1, 'bookings', true)`, [f.tenant]);
    const site = await id(c, `insert into ops.site (tenant_id, booking_mode, origins, privacy_version, consent_version) values ($1, 'slots', '{https://shop.example.invalid}', 'v1', 'v1') returning id`, [
      f.tenant,
    ]);
    await c.query(`insert into ops.site_key (tenant_id, site_id, key_sha256, prefix) values ($1, $2, $3, 'mpk_shop_abcd')`, [f.tenant, site, sha(randomUUID())]);
    const art = await id(c, `insert into ops.document (tenant_id, kind, source, storage_key, sha256, mime, bytes) values ($1, 'art', 'upload', $2, $3, 'image/svg+xml', 2000) returning id`, [
      f.tenant,
      `t-${f.tenant}/art/logo.svg`,
      sha(randomUUID()),
    ]);
    const look = await id(c, `insert into ops.site_look (tenant_id, site_id, tokens, font_pair, art) values ($1, $2, '{"--ground": "#ffffff", "--radius-card": "12px"}', 'inter', $3) returning id`, [
      f.tenant,
      site,
      JSON.stringify({ hero: art }),
    ]);
    await c.query(`insert into ops.staff_public (tenant_id, staff_id, shop_id, display_name, consent_at) values ($1, $2, $3, 'Ravi', now() - interval '1 day')`, [
      f.tenant,
      staffRow,
      f.shop,
    ]);
    return { site, look };
  });
  const owner = await db.admin.connect();
  try {
    await owner.query('begin');
    await owner.query('set local role munshi_owner');
    await owner.query(`select set_config('munshi.tenant_id', $1, true)`, [f.tenant]);
    const snap = await id(
      owner,
      `insert into snap.snapshot (tenant_id, query_name, params, purpose, columns, rows, params_sha256, rows_sha256, row_count)
       values ($1, 'site.catalogue', '{}', 'release', $2, $3, '\\x00', '\\x00', 0) returning id`,
      [f.tenant, JSON.stringify(COLUMNS), JSON.stringify(rowsOf('25000'))],
    );
    await owner.query(`insert into ops.site_release (tenant_id, site_id, look_id, snapshots, created_txid) values ($1, $2, $3, $4, 0)`, [
      f.tenant,
      site,
      look,
      JSON.stringify({ 'site.catalogue': snap }),
    ]);
    await owner.query('commit');
  } finally {
    owner.release();
  }
  // 21: a site order request for the tea (the public, no actor), confirmed as an order by the owner with its line, first
  // step and the customer's update; an advance recorded against it; a measurement with two values.
  const release = (await db.admin.query<{ id: string }>('select id from ops.site_release where tenant_id = $1', [f.tenant])).rows[0]?.id as string;
  const request = randomUUID();
  await tx(db.as('munshi_public'), { tenant_id: f.tenant }, (c) =>
    c.query(
      `insert into ops.order_request (tenant_id, id, shop_id, code, channel, kind, release_id, lines) values ($1, $2, $3, 'ORD-TEA1', 'site', 'goods', $4, $5)`,
      [f.tenant, request, f.shop, release, JSON.stringify([{ itemId: good, qtyMilli: 1000 }])],
    ),
  );
  const order = await cmd(f.owner, 'order.confirm', async (c) => {
    const o = await id(c, `insert into books.order (tenant_id, shop_id, request_id, customer_id, kind, code, currency) values ($1, $2, $3, $4, 'goods', 'ORD-TEA1', 'INR') returning id`, [
      f.tenant,
      f.shop,
      request,
      customer,
    ]);
    await c.query(
      `insert into books.order_line (tenant_id, order_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, currency)
       values ($1, $2, 1, $3, 'good', $4, 1000, 25000, 25000, 'INR')`,
      [f.tenant, o, good, goodPrice],
    );
    const body = 'Your order ORD-TEA1 is confirmed';
    const textId = await id(c, `insert into ops.message_text (tenant_id, body, author, body_sha256) values ($1, $2, 'template', $3) returning id`, [f.tenant, body, sha(body)]);
    const m = await id(
      c,
      `insert into books.outbound_message (tenant_id, channel, recipient_kind, recipient_id, template_code, text_id, body_sha256, order_id) values ($1, 'whatsapp', 'customer', $2, 'order_confirmed', $3, $4, $5) returning id`,
      [f.tenant, customer, textId, sha(body), o],
    );
    await c.query(`insert into books.order_step (tenant_id, order_id, step_no, step, due_on, message_id, at) values ($1, $2, 0, 'confirmed', current_date + 2, $3, now())`, [
      f.tenant,
      o,
      m,
    ]);
    await c.query(`update ops.order_request set state = 'confirmed' where tenant_id = $1 and id = $2`, [f.tenant, request]);
    return o;
  });
  await cmd(f.owner, 'payment.record', async (c) => {
    const p = await id(c, `insert into books.payment (tenant_id, direction, method, amount_minor, currency, customer_id, order_id, paid_at) values ($1, 'in', 'upi', 5000, 'INR', $2, $3, now()) returning id`, [
      f.tenant,
      customer,
      order,
    ]);
    await journal(c, 'order_advance', [['upi_clearing', 5000], ['customer_advance', -5000]], ['books.payment', p]);
  });
  await tx(app, { tenant_id: f.tenant, actor_id: f.staff }, async (c) => {
    const m = await id(c, `insert into ops.measurement (tenant_id, contact_id, note, taken_by, created_txid) values ($1, $2, 'Loose fit', $3, 0) returning id`, [
      f.tenant,
      customerContact,
      f.owner,
    ]);
    await c.query(`insert into ops.measurement_value (tenant_id, measurement_id, point, mm) values ($1, $2, 'chest', 960), ($1, $2, 'waist', 820)`, [f.tenant, m]);
  });
  // The public: an enquiry, a hold moved to requested with its contact, a piece held (samples on the demo).
  const pub = db.as('munshi_public');
  const versions = `'v1', 'v1'`;
  await tx(pub, { tenant_id: f.tenant }, (c) =>
    c.query(
      `insert into ops.site_request (tenant_id, site_id, shop_id, kind, source, contact_name, contact_phone_e164, notice_version, consent_version)
       values ($1, $2, $3, 'enquiry', 'site', 'Someone', '+910000000000', ${versions})`,
      [f.tenant, site, f.shop],
    ),
  );
  const holdToken = randomBytes(32).toString('base64url');
  const booking = await tx(pub, { tenant_id: f.tenant }, (c) =>
    id(
      c,
      `insert into ops.booking (tenant_id, site_id, shop_id, staff_id, service_item_id, during, state, source, hold_token_sha256, ip_hash, device_hash, shift_pattern_id)
       values ($1, $2, $3, $4, $5, ${slot('10:00', '10:30')}, 'held', 'site', $6, $7, $8, $9) returning id`,
      [f.tenant, site, f.shop, staffRow, service, sha(holdToken), sha(randomUUID()), sha(randomUUID()), pattern],
    ),
  );
  await tx(pub, { tenant_id: f.tenant, hold_token: holdToken }, async (c) => {
    await c.query(`update ops.booking set state = 'requested' where tenant_id = $1 and id = $2`, [f.tenant, booking]);
    await c.query(
      `insert into ops.booking_contact (tenant_id, booking_id, site_id, contact_name, contact_phone_e164, notice_version, consent_version)
       values ($1, $2, $3, 'Someone', '+910000000000', ${versions})`,
      [f.tenant, booking, site],
    );
  });
  // The public role cannot read a reservation's id back (it holds only the piece's state), so the id is the caller's.
  const reservation = randomUUID();
  await tx(pub, { tenant_id: f.tenant }, (c) =>
    c.query(
      `insert into ops.reservation (tenant_id, id, site_id, item_id, qty_milli, contact_name, contact_phone_e164, notice_version, consent_version)
       values ($1, $2, $3, $4, 1000, 'Someone', '+910000000000', ${versions})`,
      [f.tenant, reservation, site, good],
    ),
  );
  return {
    good,
    service,
    goodPrice,
    customer,
    customerContact,
    supplier,
    staffRow,
    terms,
    pattern,
    sale,
    purchase: purchaseId,
    registration,
    offer,
    plan,
    pack: pack.item,
    counterSale,
    holding,
    inbound,
    reorder,
    request,
    order,
    site,
    look,
    booking,
    holdToken,
    reservation,
  };
}
