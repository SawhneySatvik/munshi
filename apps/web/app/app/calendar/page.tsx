import { notFound, redirect } from "next/navigation";
import { CalendarTabs } from "../../../components/schedule/CalendarTabs";
import { ScheduleView } from "../../../components/schedule/ScheduleView";
import { loadCalendar } from "../../../lib/server/people";
import { loadSchedule } from "../../../lib/server/schedule";
import { currentSession } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Calendar" };

// ?day=YYYY-MM-DD (today by default); ?shop and ?service ask for the desk's free slots; ?view=schedule shows the day
// on the schedule board. Absent (404) without bookings.
export default async function CalendarRoute({ searchParams }: { searchParams: Promise<{ day?: string; shop?: string; service?: string; view?: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const { day, shop, service, view } = await searchParams;
  if (view === "schedule") {
    const schedule = await loadSchedule(session, day ?? null);
    if (!schedule) notFound();
    return <ScheduleView data={schedule} />;
  }
  const data = await loadCalendar(session, { day: day ?? null, shopId: shop ?? null, serviceId: service ?? null });
  if (!data) notFound();
  return <CalendarTabs data={data} />;
}
