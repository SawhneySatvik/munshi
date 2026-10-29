import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { BillView } from "../../../../components/books/BillView";
import { loadBill } from "../../../../lib/server/bills";
import { sessionFrom } from "../../../../lib/server/session";

export const metadata: Metadata = { title: "Munshi · Bill" };

// One bill of this shop. An id that is not one of its live bills is not found (RLS hides other shops' rows). ?recorded=1
// marks the request recordBill redirected to; the stamp shows only if the signed-in member is the one who entered it.
export default async function BillPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ recorded?: string | string[] }> }) {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  const [{ id }, { recorded }] = await Promise.all([props.params, props.searchParams]);
  const data = await loadBill(session, id, recorded === "1");
  if (!data) notFound();
  return <BillView data={data} />;
}
