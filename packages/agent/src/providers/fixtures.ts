import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import { ModelError } from "./redact.ts";

export type ModelMode = "live" | "recorded" | "record";
export const DEFAULT_FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures");

export function parseMode(v: string | undefined): ModelMode {
  const m = v ?? "recorded";
  if (m !== "live" && m !== "recorded" && m !== "record") throw new Error(`unknown MUNSHI_MODEL_MODE: ${m}`);
  return m;
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export function fixtureKey(request: unknown): string {
  return createHash("sha256").update(canonical(request)).digest("hex");
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Replays or records the raw (pre-validation) upstream result for a canonical request. */
export async function viaFixture<T>(mode: ModelMode, dir: string, request: unknown, shape: z.ZodType<T>, live: () => Promise<T>): Promise<T> {
  if (mode === "live") return live();
  const key = fixtureKey(request);
  const file = join(dir, `${key}.json`);
  if (mode === "recorded") {
    if (!existsSync(file)) throw new ModelError(`no recorded fixture ${key} (set MUNSHI_MODEL_MODE=record with a key to create it)`);
    const ok = shape.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!ok.success) throw new ModelError(`malformed fixture ${key}: ${ok.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    return ok.data;
  }
  const result = await live();
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(result, null, 2) + "\n");
  return result;
}
