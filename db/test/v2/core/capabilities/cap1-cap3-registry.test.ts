// CAP1 and CAP3, core's half. CAP1: every command core registers has its ref.command_capability rows, each naming a
// known command and capability (90_seal holds the same for every ref.command at build), and a command with no row is
// refused, never freed. CAP3: CAPABILITIES, the registry desks, watchers, screens and routes key into, is exactly
// ref.capability and names no business type. Expected sizes come from BLUEPRINT §2.5, not from the database.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CAPABILITIES, COMMANDS, CoreError, runCommand } from '@munshi/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { type Shop, smallShop } from '../shop.ts';

let db: TestDb;
let s: Shop;
beforeAll(async () => {
  db = await openTestDb();
  s = await smallShop(db.as('munshi_app'), 'CAP1');
  await db.sabotage();
});
afterAll(() => db.close());

const REGISTRY = path.join(import.meta.dirname, '..', '..', '..', '..', '..', 'packages', 'core', 'src', 'capabilities.ts');

it('CAP1 every command core registers has its capability rows, each naming a known command and capability', async () => {
  const { rows } = await db.admin.query<{ command: string; known: boolean }>(
    `select k.command, exists (select 1 from ref.command c where c.command = k.command)
              and exists (select 1 from ref.capability p where p.code = k.capability) as known
       from ref.command_capability k`,
  );
  expect(rows.length).toBeGreaterThan(COMMANDS.size); // sale.record alone has eight rows
  expect(rows.filter((r) => !r.known)).toEqual([]);
  const named = new Set(rows.map((r) => r.command));
  expect(COMMANDS.size).toBeGreaterThan(0);
  expect([...COMMANDS.keys()].filter((name) => !named.has(name))).toEqual([]);
  console.log(`CAP1 ${COMMANDS.size} registered commands, ${rows.length} capability rows over ${named.size} commands`);
});

it('CAP3 the capability registry is exactly ref.capability', async () => {
  const { rows } = await db.admin.query<{ code: string }>('select code from ref.capability order by code');
  expect(CAPABILITIES.length).toBe(21);
  expect([...CAPABILITIES].sort()).toEqual(rows.map((r) => r.code));
});

it('CAP3 the capability registry names no business type', async () => {
  const { rows } = await db.admin.query<{ code: string }>('select code from ref.business_type');
  expect(rows.map((r) => r.code).sort()).toEqual(['apparel', 'kirana', 'salon']);
  const source = readFileSync(REGISTRY, 'utf8');
  for (const { code } of rows) {
    expect((CAPABILITIES as readonly string[]).includes(code), code).toBe(false);
    expect(source.includes(`'${code}'`) || source.includes(`"${code}"`), code).toBe(false);
  }
});

// Last in the file: it deletes a row (as the superuser, in this file's own database) and puts it back.
it('CAP1 a command with no capability row is refused, never freed', async () => {
  const waste = { itemId: s.biscuits, qtyMilli: 1000 };
  expect(await runCommand(db.as('munshi_app'), s.owner, 'stock.waste', waste)).toEqual({ moveId: expect.any(String) });
  await db.admin.query(`delete from ref.command_capability where command = 'stock.waste'`);
  try {
    const err = await runCommand(db.as('munshi_app'), s.owner, 'stock.waste', waste).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoreError);
    expect(err).toMatchObject({ code: 'capability_off', fields: ['command'] });
  } finally {
    await db.admin.query(`insert into ref.command_capability (command, capability, use) values ('stock.waste', 'stock', 'start')`);
  }
});
