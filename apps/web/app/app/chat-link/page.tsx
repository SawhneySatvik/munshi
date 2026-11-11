import { chatLinksOf } from "@munshi/core";
import { redirect } from "next/navigation";
import { ChatLinkView } from "../../../components/app/ChatLinkView";
import { appPool } from "../../../lib/server/db";
import { currentSession } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Chat link" };

// Every member's own: a link is theirs alone, so this page shows and ends only theirs.
export default async function ChatLinkRoute() {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  const links = await chatLinksOf(await appPool(), session);
  return <ChatLinkView links={links.map((l) => ({ id: l.id, linkedAt: l.linkedAt.toISOString(), expiresAt: l.expiresAt.toISOString() }))} />;
}
