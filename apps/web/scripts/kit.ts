// pnpm kit: bundles the developer portal's content into lib/kit.gen.json, which the /developers pages import (so the
// build reads no file at request time): the Markdown pages in docs/kit, the examples recorded from the showcase shops
// (docs/kit/examples.json, written by test/kit.test.ts with MUNSHI_KIT_EXAMPLES=write), the reference from
// packages/contracts/openapi.json, and the SDK tarball's name and sha256 (packed by `pnpm sdk:pack`).
// test/developers.test.tsx fails when the bundle differs from a fresh one.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SDK_VERSION = "0.1.0";
export const KIT_PAGES = ["overview", "getting-started", "auth-and-errors", "figures", "guides", "sandbox", "sdk"] as const;

type Operation = {
  operationId: string;
  summary: string;
  security: Record<string, string[]>[];
  parameters?: { name: string; in: string; required: boolean }[];
  responses: Record<string, { content?: Record<string, unknown>; "x-munshi-error-codes"?: string[] }>;
  "x-munshi-schemas": { body: string | null; response: string | null };
  "x-munshi-cache": string;
  "x-munshi-writes": string | null;
  "x-munshi-deferred": boolean;
};

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export function buildKit(): string {
  const pages = KIT_PAGES.map((slug) => {
    const md = readFileSync(at(`../../../docs/kit/${slug}.md`), "utf8");
    const title = /^# (.+)$/m.exec(md)?.[1];
    if (!title) throw new Error(`kit: docs/kit/${slug}.md has no title`);
    return { slug, title, md };
  });
  const examples = JSON.parse(readFileSync(at("../../../docs/kit/examples.json"), "utf8")) as Record<string, { request: string; body: unknown }>;
  const reference = Object.entries(JSON.parse(readFileSync(at("../../../packages/contracts/openapi.json"), "utf8")).paths as Record<string, Record<string, Operation>>).flatMap(
    ([path, ops]) =>
      Object.entries(ops).map(([method, o]) => {
        const status = Object.keys(o.responses).find((c) => c.startsWith("2")) as string;
        const ex = examples[o.operationId];
        return {
          op: o.operationId,
          method: method.toUpperCase(),
          path,
          summary: o.summary,
          auth: o.security.length ? (o.security[0]?.secretKey ? "secret" : "publishable") : "none",
          status: Number(status),
          body: o["x-munshi-schemas"].body,
          response: o["x-munshi-schemas"].response ?? (Object.keys(o.responses[status]?.content ?? {})[0] as string),
          params: (o.parameters ?? []).map((p) => ({ name: p.name, in: p.in, required: p.required })),
          errors: Object.keys(o.responses)
            .filter((c) => !c.startsWith("2"))
            .flatMap((c) => o.responses[c]?.["x-munshi-error-codes"] ?? []),
          cache: o["x-munshi-cache"],
          writes: o["x-munshi-writes"],
          deferred: o["x-munshi-deferred"],
          example: ex ? { request: ex.request, body: JSON.stringify(ex.body, null, 2) } : null,
        };
      }),
  );
  const file = `munshi-sdk-${SDK_VERSION}.tgz`;
  const sha256 = createHash("sha256")
    .update(readFileSync(at(`../public/developers/${file}`)))
    .digest("hex");
  return `${JSON.stringify({ pages, examples, reference, sdk: { version: SDK_VERSION, href: `/developers/${file}`, sha256 } }, null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(at("../lib/kit.gen.json"), buildKit());
  process.stdout.write("wrote apps/web/lib/kit.gen.json\n");
}
