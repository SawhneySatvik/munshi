import { deploymentKind, listDemoShops } from "@munshi/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Panel, words } from "../(auth)/panel";
import { type Notice, Onboarding } from "../../components/site/Onboarding";
import { appPool } from "../../lib/server/db";

export const metadata: Metadata = { title: "Munshi · Demo" };

type Query = { invalid?: string | string[]; taken?: string | string[]; limit?: string | string[] };

// The demo picker, demo deployment only (404 on live): the directory's sample shops (synthetic and
// showcase, never a live tenant or a sandbox), each opening its people; and a visitor's own sample shop, a sandbox
// for seven days with no email and no password, made through the onboarding screens (the site's sign-up uses the same).
export default async function DemoPage(props: { searchParams: Promise<Query> }) {
  const pool = await appPool();
  if ((await deploymentKind(pool)) !== "demo") notFound();
  const [q, w, shops] = await Promise.all([props.searchParams, words(), listDemoShops(pool)]);
  const notice: Notice | undefined = q.invalid === "1" ? "invalid" : q.taken === "1" ? "taken" : q.limit === "1" ? "limit" : undefined;
  return (
    <Panel id="demo-h" title={w.demoTitle} lede={shops.length ? w.demoLede : w.demoNoShop} wide>
      <ul className="s-card-list">
        {shops.map((s, i) => (
          <li key={s.tenantId}>
            <Link className={`s-card${i === 0 ? " is-lead" : ""}`} href={`/demo/${s.slug}`}>
              <span data-name="">{s.name}</span>
              <span className="s-card-k">{w.openShop} →</span>
            </Link>
          </li>
        ))}
      </ul>
      <h2 className="s-screen-h2" id="sample-h">
        {w.sampleTitle}
      </h2>
      <p className="s-screen-lede">{w.sampleLede}</p>
      <Onboarding back="demo" notice={notice} />
    </Panel>
  );
}
