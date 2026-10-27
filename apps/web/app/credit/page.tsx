import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CreditBook } from "../../components/CreditBook";
import { loadCredit } from "../../lib/server/credit";
import { sessionFrom } from "../../lib/server/session";

export const metadata = { title: "Munshi · Credit book" };

export default async function CreditRoute() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  return <CreditBook data={await loadCredit(session)} />;
}
