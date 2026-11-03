// What withTx knows about each open transaction: its acting member (none in a system scope), and what the read gate
// looked up for that member once (read-roles.ts). Set by withTx after it sets the context, dropped when the transaction
// ends. Not exported from index.ts: only core's own modules see it.
import type pg from 'pg';

export type TxState = { memberId: string | null; memo: Map<string, unknown> };

const OPEN = new WeakMap<pg.ClientBase, TxState>();

export const openTx = (c: pg.ClientBase, memberId: string | null) => OPEN.set(c, { memberId, memo: new Map() });
export const closeTx = (c: pg.ClientBase) => OPEN.delete(c);
export const txState = (c: pg.ClientBase): TxState | undefined => OPEN.get(c);
