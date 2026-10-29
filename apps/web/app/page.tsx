import { redirect } from "next/navigation";

// The owner app lives under /app; the product site takes this address next (BP-WEB-1).
export default function Root() {
  redirect("/app");
}
