import business from "@business";
import { notFound } from "next/navigation";
import { OrderIntake } from "../../../components/OrderIntake.tsx";
import { Shell } from "../../../components/Shell.tsx";
import { browserApi, getCatalogue, getSite, has } from "../../../lib/api.ts";
import { copy, langOf } from "../../../lib/page.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  return { title: copy("orderPageTitle", await langOf(params)) };
}

export default async function Order({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  if (business.profile.kind !== "apparel") notFound();
  const site = await getSite();
  const on = has(site, "orders");
  const items = on ? (await getCatalogue()).flatMap((i) => i.variants.map((v) => ({ id: v.id, name: v.name, price: v.price }))) : [];
  const shop = site.shops[0];
  return (
    <Shell lang={lang} path="/order" site={site} api={browserApi()}>
      <header className="page-head">
        <h1>{copy("orderPageTitle", lang)}</h1>
        <p className="muted">{copy(on ? "orderPageLine" : "ordersOff", lang)}</p>
      </header>
      {on && shop ? (
        <section className="section" data-capability="orders">
          <OrderIntake lang={lang} shopId={shop.id} items={items} />
        </section>
      ) : null}
    </Shell>
  );
}
