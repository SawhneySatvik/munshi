// The developer portal's content, bundled by `pnpm kit` (scripts/kit.ts) from docs/kit and the SDK tarball.
import type { RefRoute } from "../components/dev/Reference";
import bundle from "./kit.gen.json";

export type KitPage = { slug: string; title: string; md: string };
export type KitExample = { request: string; status: number; body: unknown };

export const KIT = bundle as { pages: KitPage[]; examples: Record<string, KitExample>; reference: RefRoute[]; sdk: { version: string; href: string; sha256: string } };
