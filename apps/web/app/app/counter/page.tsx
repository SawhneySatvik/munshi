import { redirect } from "next/navigation";
import { Counter } from "../../../components/Counter";
import { loadCounter } from "../../../lib/server/counter";
import { formKey } from "../../../lib/server/form-key";
import { currentSession } from "../../../lib/server/session";

export const metadata = { title: "Munshi · Counter" };

export default async function CounterRoute() {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  return <Counter data={await loadCounter(session)} formKey={formKey()} />;
}
