import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AskView } from "../../../components/AskView";
import { RECORDED_DESK, RECORDED_QUESTIONS } from "../../../lib/i18n-hero";
import { recordedMode } from "../../../lib/server/agent-port";
import { floorOf } from "../../../lib/server/ops";
import { currentSession } from "../../../lib/server/session";

export const metadata: Metadata = { title: "Munshi · Ask" };

// Ask the books: typed or spoken, answered from cells or "Cannot verify". This session's questions live in the layout's
// ask provider, so the page itself reads only who is asking.
export default async function AskRoute() {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const floor = await floorOf(session);
  const recorded = recordedMode();
  // Only the recorded questions whose desk the member may ask (core's map: staff are not offered the sales one).
  const questions = recorded ? RECORDED_QUESTIONS.filter((q) => floor.desks.includes(RECORDED_DESK[q] ?? "")) : [];
  // A recorded demo names the business day its questions are asked as of: the day the recorded answers were asked on.
  const day = recorded ? floor.askDate : null;
  return <AskView data={{ shop: floor.shop, member: floor.member, recorded, questions, day }} />;
}
