import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { SuppliersView } from "../../../components/books/SuppliersView";
import { loadSuppliers } from "../../../lib/server/suppliers";
import { currentSession } from "../../../lib/server/session";

export const metadata: Metadata = { title: "Munshi · Suppliers" };

// The shop's (simulated) suppliers with their last prices, and the reorder drafts waiting for a decision. The owner's and
// a manager's: anyone else gets 404.
export default async function SuppliersPage() {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const data = await loadSuppliers(session);
  if (!data) notFound();
  return <SuppliersView data={data} />;
}
