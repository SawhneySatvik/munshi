import { deploymentKind, listDemoShops, viewSignIn } from "@munshi/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SignIn } from "../../../components/SignIn";
import { appPool } from "../../../lib/server/db";
import type { Member } from "../../../lib/types";

export const metadata: Metadata = { title: "Munshi · Demo" };

// One sample shop's people, read under its own tenant with no actor: a shop the picker does not list —
// a live tenant, a sandbox, an unknown slug — is not found, and so is the whole page on a live deployment.
export default async function DemoShopPage(props: { params: Promise<{ slug: string }> }) {
  const pool = await appPool();
  if ((await deploymentKind(pool)) !== "demo") notFound();
  const { slug } = await props.params;
  const shop = (await listDemoShops(pool)).find((s) => s.slug === slug);
  if (!shop) notFound();
  const members = await viewSignIn(pool, shop.tenantId);
  return <SignIn members={members as Array<Member & { id: string }>} />;
}
