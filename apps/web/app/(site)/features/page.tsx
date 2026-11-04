import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Features } from "../../../components/site/Features";
import { FEATURE_WORDS } from "../../../components/site/features-words";
import { LANG_COOKIE, parseLang } from "../../../lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const f = FEATURE_WORDS[parseLang((await cookies()).get(LANG_COOKIE)?.value)];
  return { title: f.metaTitle, description: f.metaBody };
}

// Reads no database, like the rest of the product site: every figure here is a labelled sample.
export default function FeaturesPage() {
  return <Features />;
}
