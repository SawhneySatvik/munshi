import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BillForm } from "../../../../components/books/BillForm";
import { loadBillForm } from "../../../../lib/server/bills";
import { formKey } from "../../../../lib/server/form-key";
import { currentSession } from "../../../../lib/server/session";

export const metadata: Metadata = { title: "Munshi · Record a bill" };

// Recording a supplier's paper bill by hand: the suppliers and the catalogue to pick from. A role that cannot record a
// bill sees why, and no form. The owner's and a manager's: anyone else gets 404.
export default async function NewBillPage() {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const data = await loadBillForm(session);
  if (!data) notFound();
  return <BillForm data={data} formKey={formKey()} />;
}
