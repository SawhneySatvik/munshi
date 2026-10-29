import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Counter } from "../../../components/Counter";
import { loadCounter } from "../../../lib/server/counter";
import { sessionFrom } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Counter" };

export default async function CounterRoute() {
  const session = await sessionFrom(await cookies());
  if (!session) redirect("/sign-in");
  return <Counter data={await loadCounter(session)} />;
}
