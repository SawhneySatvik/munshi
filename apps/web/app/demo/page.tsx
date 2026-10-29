import { deploymentKind, listDemoShops } from "@munshi/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Field, Panel, words } from "../(auth)/panel";
import { Button } from "../../components/Button";
import { appPool } from "../../lib/server/db";
import { makeSampleShop } from "./actions";

export const metadata: Metadata = { title: "Munshi · Demo" };

type Query = { invalid?: string | string[]; taken?: string | string[]; limit?: string | string[] };

// The demo picker (BLUEPRINT §6.6), demo deployment only (404 on live, F2): the directory's sample shops (synthetic and
// showcase, never a live tenant or a sandbox, F3), each opening its people; and a judge's own sample shop, a sandbox
// for seven days with no email and no password.
export default async function DemoPage(props: { searchParams: Promise<Query> }) {
  const pool = await appPool();
  if ((await deploymentKind(pool)) !== "demo") notFound();
  const [q, w, shops] = await Promise.all([props.searchParams, words(), listDemoShops(pool)]);
  const notice = q.invalid === "1" ? w.sampleInvalid : q.taken === "1" ? w.sampleTaken : q.limit === "1" ? w.sampleLimit : undefined;
  return (
    <Panel id="demo-h" title={w.demoTitle} lede={shops.length ? w.demoLede : w.demoNoShop}>
      <ul className="people">
        {shops.map((s) => (
          <li key={s.tenantId}>
            <Link className="press" href={`/demo/${s.slug}`}>
              <span data-name="">{s.name}</span>
              <span className="role">{w.openShop}</span>
            </Link>
          </li>
        ))}
      </ul>
      <h2 id="sample-h">{w.sampleTitle}</h2>
      <p className="sign-in-lede">{w.sampleLede}</p>
      {notice ? (
        <p className="field-note" role="alert">
          {notice}
        </p>
      ) : null}
      <form action={makeSampleShop} className="people" aria-labelledby="sample-h">
        <label className="field">
          <span className="kicker field-label">{w.businessType}</span>
          <select name="businessType" className="input" defaultValue="kirana">
            <option value="kirana">{w.kirana}</option>
            <option value="apparel">{w.apparel}</option>
            <option value="salon">{w.salon}</option>
          </select>
        </label>
        <Field label={w.shopName} name="name" type="text" autoComplete="organization" />
        <Field label={w.webAddress} name="slug" type="text" autoComplete="off" />
        <Field label={w.yourName} name="ownerName" type="text" autoComplete="name" />
        <Button type="submit" variant="primary">
          {w.makeSample}
        </Button>
      </form>
    </Panel>
  );
}
