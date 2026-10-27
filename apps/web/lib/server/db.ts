// The app pool (server only). It must connect as munshi_app: a superuser or a BYPASSRLS role would skip forced RLS and
// the book guard's grants, so before the pool is first handed out it checks who it is and refuses to serve otherwise.
import { createAppPool } from "@munshi/core";
import { config } from "./config";

type Pool = ReturnType<typeof createAppPool>;

// Kept on globalThis so next dev's module reloads reuse one pool instead of opening a new one per edit.
const held = globalThis as typeof globalThis & { munshiPool?: Promise<Pool> | undefined };

async function open(): Promise<Pool> {
  const pool = createAppPool(config().databaseUrl);
  try {
    const { rows } = await pool.query<{ role: string; superuser: boolean; bypass: boolean }>(
      "select rolname as role, rolsuper as superuser, rolbypassrls as bypass from pg_roles where rolname = current_user",
    );
    const me = rows[0];
    if (me?.role !== "munshi_app" || me.superuser || me.bypass) {
      throw new Error("db: the app must connect as munshi_app (not a superuser, no BYPASSRLS); refusing to serve");
    }
  } catch (err) {
    await pool.end();
    throw err;
  }
  return pool;
}

export function appPool(): Promise<Pool> {
  held.munshiPool ??= open().catch((err) => {
    held.munshiPool = undefined; // a later request retries (the database may still be starting)
    throw err;
  });
  return held.munshiPool;
}
