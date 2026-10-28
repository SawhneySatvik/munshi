import business from "@business";
import { Shell } from "../../components/Chrome.tsx";
import { SalonHome } from "../../components/SalonHome.tsx";
import { ShopHome } from "../../components/ShopHome.tsx";
import { langOf } from "../../lib/page.ts";

export default async function Home({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  return <Shell lang={lang} path="/">{business.profile.kind === "salon" ? <SalonHome lang={lang} /> : <ShopHome lang={lang} />}</Shell>;
}
