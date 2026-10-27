// Drafts and decisions: nothing auto-applies. A draft names a command, its payload and the snapshot cells it relied on
// (based_on). decide() runs on the approver's own request — the approver is the session's member, there is no other
// parameter for it — and in ONE transaction: lock the draft, re-check its evidence (changed → `stale`, and only that is
// committed), insert the decision, execute the command under it (the guard admits and audits each book row as the
// approver), mark the draft executed, and audit the decision itself.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { command, execute, parseInput } from './commands.ts';
import { CoreError } from './errors.ts';
import { type CellRef, formatRef, resolveRef } from './read.ts';
import { type Session, withTx } from './session.ts';
import { recheck } from './snapshots.ts';

export type Proposer = { session: Session } | { tenantId: string; runId: string }; // a member, or an agent/watcher run

export type DraftInput = { command: string; payload: unknown; basedOn: CellRef[]; findingId?: string };

const refSchema = z.strictObject({ snapshotId: z.guid(), row: z.number().int().nonnegative(), col: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/) });
const draftSchema = z.strictObject({ command: z.string(), payload: z.unknown(), basedOn: z.array(refSchema).max(50), findingId: z.guid().optional() });

export type Decision =
  | { status: 'executed'; decisionId: string; result: Record<string, unknown> }
  | { status: 'rejected'; decisionId: string }
  | { status: 'stale'; changed: string[] };

export async function proposeDraft(pool: pg.Pool, by: Proposer, input: DraftInput): Promise<string> {
  const r = draftSchema.safeParse(input);
  if (!r.success) throw new CoreError('invalid', { fields: r.error.issues.map((i) => i.path.join('.') || '(draft)') });
  const d = r.data;
  const payload = parseInput(command(d.command), d.payload); // stored normalised; re-parsed at decision time
  const scope = 'session' in by ? ({ kind: 'member', session: by.session } as const) : ({ kind: 'system', tenantId: by.tenantId } as const);
  const draftId = randomUUID();
  await withTx(pool, scope, async (c) => {
    for (const ref of d.basedOn) {
      if (!(await resolveRef(c, ref))) throw new CoreError('invalid', { fields: ['basedOn'] }); // a ref must name a stored cell
    }
    await c.query(
      `insert into approval.draft (tenant_id, id, command_type, payload, based_on, run_id, proposed_by, finding_id)
       values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5, $6, $7)`,
      [
        draftId,
        d.command,
        payload,
        JSON.stringify(d.basedOn),
        'runId' in by ? by.runId : null,
        'session' in by ? by.session.memberId : null,
        d.findingId ?? null,
      ],
    );
  });
  return draftId;
}

async function auditDecision(c: pg.PoolClient, session: Session, draftId: string, command: string, action: string, decisionId: string | null, payload: object) {
  await c.query(
    `insert into audit.audit_log (tenant_id, actor_id, decision_id, command, action, entity, entity_id, payload)
     values ($1, $2, $3, $4, $5, 'approval.draft', $6, $7)`,
    [session.tenantId, session.memberId, decisionId, command, action, draftId, payload],
  );
}

export function decide(
  pool: pg.Pool,
  session: Session,
  draftId: string,
  verdict: 'approved' | 'rejected',
  reason?: string,
): Promise<Decision> {
  return withTx(pool, { kind: 'member', session }, async (c): Promise<Decision> => {
    const { rows } = await c.query<{ command_type: string; payload: unknown; based_on: CellRef[]; status: string }>(
      'select command_type, payload, based_on, status from approval.draft where id = $1 for update',
      [draftId],
    );
    const draft = rows[0];
    if (!draft) throw new CoreError('not_found');
    if (draft.status !== 'proposed') throw new CoreError('not_proposed');
    const set = (status: string) => c.query('update approval.draft set status = $1, updated_at = now() where id = $2', [status, draftId]);
    const decisionId = randomUUID();
    const insertDecision = () =>
      c.query(
        `insert into approval.decision (tenant_id, id, draft_id, verdict, decided_by, reason)
         values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5)`,
        [decisionId, draftId, verdict, session.memberId, reason ?? null],
      );

    if (verdict === 'rejected') {
      await insertDecision();
      await set('rejected');
      await auditDecision(c, session, draftId, draft.command_type, 'draft.rejected', decisionId, { reason: reason ?? null });
      return { status: 'rejected', decisionId };
    }

    const changed = await recheck(c, draft.based_on);
    if (changed.length) {
      await set('stale');
      await auditDecision(c, session, draftId, draft.command_type, 'draft.stale', null, { changed });
      return { status: 'stale', changed };
    }

    const d = command(draft.command_type);
    const input = parseInput(d, draft.payload);
    await insertDecision();
    await c.query(`select set_config('munshi.decision_id', $1, true)`, [decisionId]);
    const result = await execute(c, d, input);
    await set('executed');
    await auditDecision(c, session, draftId, draft.command_type, 'draft.executed', decisionId, { refs: draft.based_on.map(formatRef) });
    return { status: 'executed', decisionId, result };
  });
}
