import { notFound, redirect } from "next/navigation";
import { SalaryView } from "../../../../components/app/PeopleViews";
import { loadSalary } from "../../../../lib/server/people";
import { currentSession } from "../../../../lib/server/session";

export const metadata = { title: "Munshi · Salary" };

// ?month=YYYY-MM (this month by default). Absent (404) while the shop cannot use salary.
export default async function SalaryRoute({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const { month } = await searchParams;
  const data = await loadSalary(session, month ?? null);
  if (!data) notFound();
  return <SalaryView data={data} />;
}
