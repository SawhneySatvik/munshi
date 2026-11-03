import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ReportView } from "../../../components/books/ReportView";
import { REPORT_VIEWS, type ReportView as View } from "../../../lib/books";
import { loadReport } from "../../../lib/server/reports";
import { sessionFrom } from "../../../lib/server/session";

export const metadata: Metadata = { title: "Munshi · Day report" };

// The day report under the signed-in member; ?view= picks yesterday (the default), today or the week. Any other value
// is the default rather than an error: it is a choice of page, not an input to the books. The owner's and a manager's:
// anyone else gets 404.
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  const asked = (await searchParams).view;
  const view = REPORT_VIEWS.find((v) => v === asked) ?? ("yesterday" satisfies View);
  const data = await loadReport(session, view);
  if (!data) notFound();
  return <ReportView data={data} />;
}
