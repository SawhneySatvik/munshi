import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AskView } from "../../../components/AskView";
import { RECORDED_QUESTIONS } from "../../../lib/i18n-hero";
import { recordedMode } from "../../../lib/server/agent-port";
import { floorOf } from "../../../lib/server/ops";
import { sessionFrom } from "../../../lib/server/session";

export const metadata: Metadata = { title: "Munshi · Ask" };

// Ask the books: typed or spoken, answered from cells or "Cannot verify". This session's questions live in the layout's
// ask provider, so the page itself reads only who is asking.
export default async function AskRoute() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  const floor = await floorOf(session);
  const recorded = recordedMode();
  return <AskView data={{ shop: floor.shop, member: floor.member, recorded, questions: recorded ? RECORDED_QUESTIONS : [] }} />;
}
