import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KitPageView } from "../../../../components/dev/KitPageView";
import { KIT } from "../../../../lib/kit";

// The Markdown pages of docs/kit that have no page of their own (the overview is /developers, the SDK /developers/sdk).
const OWN = new Set(["overview", "sdk"]);
const pages = () => KIT.pages.filter((p) => !OWN.has(p.slug));

export const dynamicParams = false;
export const generateStaticParams = () => pages().map((p) => ({ page: p.slug }));

export async function generateMetadata({ params }: { params: Promise<{ page: string }> }): Promise<Metadata> {
  const { page } = await params;
  const p = pages().find((x) => x.slug === page);
  return { title: p ? `Munshi · ${p.title}` : "Munshi · Developers" };
}

export default async function KitPage({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!pages().some((p) => p.slug === page)) notFound();
  return <KitPageView slug={page} />;
}
