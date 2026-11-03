import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { BriefView } from "../../../components/app/OfficeViews";
import { Desks } from "../../../components/office/Desks";
import { SurplusTally } from "../../../components/SurplusTally";
import { loadOffice } from "../../../lib/server/desks";
import { sessionFrom } from "../../../lib/server/session";

export const metadata = { title: "Munshi · The office" };

type Query = { cast?: string | string[]; run?: string | string[] };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// The morning brief of each branch (BLUEPRINT §7.6): its order a cell of brief.ranked, each line's figure a cell. Under
// the scene, the desks and the run log (W1-B), their counts cells of desks.week, an opened run's steps of desks.trace; the
// scene's states from each member's latest run. One page transaction for all of it. The owner's and a manager's (counter
// staff answer 404, as they have no office in the navigation). `?cast=` filters the run log; `?run=` opens a run.
export default async function OfficeRoute(props: { searchParams?: Promise<Query> } = {}) {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  const q = (await props.searchParams) ?? {};
  const { brief, desks, states, impact } = await loadOffice(session, { cast: one(q.cast), run: one(q.run) });
  if (!desks) notFound(); // core's map: the office's desks are read only for the owner and a manager (D-082)
  const data = { ...brief, snapshots: [...brief.snapshots, ...desks.snapshots, ...(impact ? [impact.snapshot] : [])] };
  // The surplus tally (items given, rupees not wasted) sits before the desks, each figure a cell of its snapshot.
  const surplus = impact ? <SurplusTally tally={impact.tally} manage /> : null;
  return <BriefView data={data} desks={<Desks data={desks} />} surplus={surplus} states={states} />;
}
