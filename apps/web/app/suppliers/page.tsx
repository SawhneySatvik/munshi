import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SuppliersView } from "../../components/books/SuppliersView";
import { loadSuppliers } from "../../lib/server/suppliers";
import { sessionFrom } from "../../lib/server/session";

export const metadata: Metadata = { title: "Munshi · Suppliers" };

// The shop's (simulated) suppliers with their last prices, and the reorder drafts waiting for a decision.
export default async function SuppliersPage() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  return <SuppliersView data={await loadSuppliers(session)} />;
}
