import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BillForm } from "../../../../components/books/BillForm";
import { loadBillForm } from "../../../../lib/server/bills";
import { formKey } from "../../../../lib/server/form-key";
import { sessionFrom } from "../../../../lib/server/session";

export const metadata: Metadata = { title: "Munshi · Record a bill" };

// Recording a supplier's paper bill by hand: the suppliers and the catalogue to pick from. A role that cannot record a
// bill sees why, and no form.
export default async function NewBillPage() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  return <BillForm data={await loadBillForm(session)} formKey={formKey()} />;
}
