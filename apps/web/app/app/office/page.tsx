import { notFound, redirect } from "next/navigation";
import { BriefView } from "../../../components/app/BriefView";
import { Desks } from "../../../components/office/Desks";
import { doingKey } from "../../../components/office/doing";
import { KeeperDesk } from "../../../components/office/KeeperDesk";
import { SurplusTally } from "../../../components/SurplusTally";
import { loadOffice } from "../../../lib/server/desks";
import { currentSession } from "../../../lib/server/session";

export const metadata = { title: "Munshi · The office" };

type Query = { cast?: string | string[]; run?: string | string[] };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// The morning brief of each branch: its order a cell of brief.ranked, each line's figure a cell. Under
// the scene, the desks and the run log, their counts cells of desks.week, an opened run's steps of desks.trace; the
// scene's states from each member's latest run. One page transaction for all of it, Keeper's notes
// under the run log included. The owner's and a manager's (counter staff answer 404, as they have no office in the navigation).
// `?cast=` filters the run log; `?run=` opens a run.
export default async function OfficeRoute(props: { searchParams?: Promise<Query> } = {}) {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const q = (await props.searchParams) ?? {};
  const { brief, desks, states, keeper, impact, kind, trayWaiting } = await loadOffice(session, { cast: one(q.cast), run: one(q.run) });
  if (!desks) notFound(); // core's map: the office's desks are read only for the owner and a manager
  // Keeper's desk: the notes in force, read in the office's one transaction; the office's like the desks. The
  // surplus tally, from the same transaction, each figure a cell of its snapshot.
  const data = { ...brief, snapshots: [...brief.snapshots, ...desks.snapshots, ...(keeper?.snapshots ?? []), ...(impact ? [impact.snapshot] : [])] };
  // In the scene, Keeper is at work on a day a note was written (each such note its memory event), idle otherwise.
  const written = keeper?.writtenToday ?? [];
  const scene = { ...states, keeper: written.length ? ("drafting" as const) : (states.keeper ?? ("idle" as const)) };
  const events = written.map((id) => ({ id, kind: "memory" as const, agent: "keeper" as const }));
  // Each member's bubble, from its state and its latest run's cells; a member with neither is left to the scene.
  const doing = Object.fromEntries(desks.cards.flatMap((c) => (c.latest || scene[c.cast] ? [[c.cast, doingKey(c.cast, scene[c.cast], c.latest)]] : [])));
  // The surplus tally (items given, rupees not wasted) sits before the desks.
  const surplus = impact ? <SurplusTally tally={impact.tally} manage /> : null;
  return (
    <BriefView
      data={data}
      desks={<Desks data={desks} after={keeper && <KeeperDesk data={keeper} />} />}
      surplus={surplus}
      states={scene}
      doing={doing}
      trayWaiting={trayWaiting}
      events={events}
      kind={kind}
    />
  );
}
