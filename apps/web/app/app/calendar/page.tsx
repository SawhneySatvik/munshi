import { notFound, redirect } from "next/navigation";
import { CalendarView } from "../../../components/app/PeopleViews";
import { loadCalendar } from "../../../lib/server/people";
import { currentSession } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Calendar" };

// ?day=YYYY-MM-DD (today by default); ?shop and ?service ask for the desk's free slots. Absent (404) without bookings.
export default async function CalendarRoute({ searchParams }: { searchParams: Promise<{ day?: string; shop?: string; service?: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const { day, shop, service } = await searchParams;
  const data = await loadCalendar(session, { day: day ?? null, shopId: shop ?? null, serviceId: service ?? null });
  if (!data) notFound();
  return <CalendarView data={data} />;
}
