// The parts that need no database: runCommand refuses every draft-only command before it opens a transaction (so
// a null pool is enough: reaching the pool would be a TypeError, not a refusal), and decide() refuses a free-text reason
// before it opens one. The proposal/approval hooks and the holdingId rule need Postgres: db/test/ms22a-hooks.test.ts.
import { expect, it } from 'vitest';
import { COMMANDS, CoreError, decide, REASONS, runCommand } from '../src/index.ts';

const noPool = null as never;
const session = null as never;

it('runCommand refuses every draft-only command in the registry', async () => {
  const registry = COMMANDS as Map<string, (typeof COMMANDS extends ReadonlyMap<string, infer D> ? D : never)>;
  const real = registry.get('stock.waste');
  if (!real) throw new Error('stock.waste is not registered');
  registry.set('test.draft_only', { ...real, draftOnly: true });
  try {
    const draftOnly = [...registry].filter(([, d]) => d.draftOnly).map(([n]) => n);
    expect(draftOnly).toContain('test.draft_only'); // a positive expected count: the loop below is not vacuous
    for (const name of draftOnly) {
      const err = await runCommand(noPool, session, name, {}).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CoreError);
      expect(err).toMatchObject({ code: 'refused', fields: ['command'] });
    }
    // An ordinary command is not refused up front: it reaches the transaction, where the null pool fails as 'internal'.
    expect(await runCommand(noPool, session, 'stock.waste', { itemId: crypto.randomUUID(), qtyMilli: 1 }).catch((e: unknown) => e)).toMatchObject({ code: 'internal' });
  } finally {
    registry.delete('test.draft_only');
  }
});

it('the registries compose their per-area files: customer.create and staff.create are still there', () => {
  expect(COMMANDS.has('customer.create')).toBe(true);
  expect(COMMANDS.has('staff.create')).toBe(true);
});

it('decide() takes a reason code, never free text', async () => {
  expect(REASONS).toContain('not_now');
  for (const words of ['enough stock', 'Ramesh was rude', '']) {
    expect(await decide(noPool, session, crypto.randomUUID(), 'rejected', words as never).catch((e: unknown) => e)).toMatchObject({ code: 'invalid', fields: ['reason'] });
  }
});
