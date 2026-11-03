"use server";

// "Why this number": the source drawer asks for the walk from the figure it shows. The ref comes from the
// drawer (a snapshot id, the row as shown, 1-based, and a column); the person from sessionFrom(). Core refuses a figure
// the member's role may not see and cuts every node reached through a read they may not make.
import { cookies } from "next/headers";
import { loadWhy, type WhyResult } from "../../lib/server/memory";
import { UUID } from "../../lib/parse";
import { sessionFrom } from "../../lib/server/session";

const COL = /^[a-z_][a-z0-9_]{0,62}$/;

export async function whyNumber(ref: { snapshotId: string; row: number; col: string }): Promise<WhyResult> {
  if (!UUID.test(ref?.snapshotId ?? "") || !Number.isInteger(ref.row) || ref.row < 1 || ref.row > 500 || !COL.test(ref.col ?? "")) return { error: "other" };
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "other" };
  return loadWhy(session, { snapshotId: ref.snapshotId, row: ref.row - 1, col: ref.col });
}
