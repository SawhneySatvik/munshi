// GET /findings, GET /drafts, POST /drafts: server-to-server with a secret developer key, which is specified but not
// built yet (the keys have no table). Until then these routes answer 404. A proposal never decides or executes: the
// draft waits for a person, and every number in it is a ref.
import { z } from 'zod';
import { Id, ListQuery, MoneyFigure, Ref, Timestamp } from './common.ts';
import { page } from './lib.ts';

const Code = z.string().regex(/^[a-z_]{2,40}$/);
export const Finding = z.strictObject({
  id: Id,
  shopId: Id.nullable(),
  desk: Code,
  kind: Code,
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  status: z.enum(['open', 'snoozed', 'dismissed', 'resolved']),
  // rupees at stake per month, the finding's impact cell
  impact: MoneyFigure.nullable(),
  firstSeenAt: Timestamp,
  lastSeenAt: Timestamp,
});
export const FindingsQuery = ListQuery.extend({ status: z.enum(['open', 'snoozed', 'dismissed', 'resolved']).optional() });
export const FindingsPage = page(Finding);

const DraftStatus = z.enum(['proposed', 'executed', 'rejected', 'stale', 'failed', 'superseded']);
const Command = z.string().regex(/^[a-z_]+(\.[a-z_]+)+$/);
export const Draft = z.strictObject({
  id: Id,
  command: Command,
  status: DraftStatus,
  source: z.enum(['member', 'run']),
  desk: Code.nullable(),
  findingId: Id.nullable(),
  basedOn: z.array(Ref).min(1).max(50),
  createdAt: Timestamp,
});
export const DraftsQuery = ListQuery.extend({ status: DraftStatus.optional() });
export const DraftsPage = page(Draft);

// A payload value is an id, digit-free text, a flag, or a ref: a number can enter only as the cell it names.
const PayloadValue = z.union([
  Id,
  z.string().max(500).regex(/^\P{Nd}*$/u),
  z.boolean(),
  z.null(),
  z.strictObject({ ref: Ref }),
]);
export const DraftProposal = z.strictObject({
  command: Command,
  payload: z.record(z.string().regex(/^[a-zA-Z_]{1,40}$/), PayloadValue),
  basedOn: z.array(Ref).min(1).max(50),
  findingId: Id.optional(),
});
export const DraftProposed = z.strictObject({ id: Id, status: z.literal('proposed') });
