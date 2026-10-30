"use client";

import { createPlanAction, redeemAction } from "../../app/app/packages/actions";
import { fill } from "../../lib/i18n";
import { APP } from "../../lib/i18n-app";
import type { PackagesPage } from "../../lib/server/sell";
import { useLang } from "../LangProvider";
import { Figure } from "../shell/Figure";
import { ActForm, Field, Group, Name, Row, Screen } from "./Kit";

/** /app/packages: the plans, who holds one with what is left (cells), and a holding opened to redeem a session. */
export function PackagesView({ data }: { data: PackagesPage }) {
  const { lang } = useLang();
  const a = APP[lang];
  const owner = data.may.includes("package.plan.create");
  const open = data.open;
  return (
    <Screen
      frame={data}
      id="packages-h"
      kicker={fill(a.packagesKicker, { shop: <span data-name="">{data.shop}</span> })}
      title={a.packagesTitle}
      lede={a.packagesLede}
      aside={
        <>
          {open && (
            <section className="sheet act" aria-labelledby="redeem-h">
              <h2 id="redeem-h" className="act-title">
                {a.balanceHeading}
              </h2>
              <p>
                <Name>{open.customer}</Name> · <Name>{open.plan}</Name>
              </p>
              <div className="l-card">
                {open.rows.map((r) => (
                  <Row key={r.itemId} title={<Name>{r.service}</Name>} amt={fill(a.balanceLine, { n: <Figure cell={r.left} /> })}>
                    {r.any && data.may.includes("package.redeem") ? (
                      <ActForm action={redeemAction} formKey={data.formKey} tag={`redeem-${r.itemId.slice(-12)}`} submit={fill(a.redeemSubmit, { service: <Name>{r.service}</Name> })} inline>
                        <input type="hidden" name="holding" value={open.id} />
                        <input type="hidden" name="item" value={r.itemId} />
                        <Field label={a.redeemAt}>
                          <select name="shop" className="input" defaultValue={data.shops[0]?.id}>
                            {data.shops.map((s) => (
                              <option key={s.id} value={s.id} data-name="">
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </ActForm>
                    ) : (
                      <p className="l-sub">{a.redeemNone}</p>
                    )}
                  </Row>
                ))}
              </div>
            </section>
          )}
          {owner && (
            <ActForm action={createPlanAction} formKey={data.formKey} tag="plan" title={a.planCreate} submit={a.planSubmit} primary>
              <Field label={a.planName}>
                <input name="name" className="input" required maxLength={120} autoComplete="off" />
              </Field>
              <div className="act-pair">
                <Field label={a.planPrice}>
                  <input name="price" className="input" inputMode="decimal" required autoComplete="off" />
                </Field>
                <Field label={a.planDays}>
                  <input name="days" className="input" inputMode="numeric" required autoComplete="off" />
                </Field>
              </div>
              <div className="act-pair">
                <Field label={a.planService}>
                  <select name="service" className="input" defaultValue="">
                    <option value="" disabled>
                      {a.pick}
                    </option>
                    {data.services.map((s) => (
                      <option key={s.id} value={s.id} data-name="">
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={a.planCount}>
                  <input name="sessions" className="input" inputMode="numeric" required autoComplete="off" />
                </Field>
              </div>
            </ActForm>
          )}
        </>
      }
    >
      <Group id="plans-h" title={a.plansHeading} empty={a.plansEmpty}>
        {data.plans.map((p) => (
          <Row
            key={p.id}
            title={<Name>{p.name}</Name>}
            sub={p.lines.map((l, i) => (
              <span key={l.service}>
                {i > 0 && " · "}
                {fill(a.planSessions, { n: <Figure cell={l.sessions} />, service: <Name>{l.service}</Name> })}
              </span>
            ))}
            amt={<Figure cell={p.price} />}
          >
            <p className="app-line">{fill(a.planLine, { price: <Figure cell={p.price} />, days: <Figure cell={p.days} /> })}</p>
          </Row>
        ))}
      </Group>
      <Group id="holdings-h" title={a.holdingsHeading} empty={a.holdingsEmpty}>
        {data.holdings.map((x) => (
          <Row
            key={x.id}
            title={<Name>{x.customer}</Name>}
            sub={
              <>
                <Name>{x.plan}</Name> · {fill(a.holdingExpires, { day: <Figure cell={x.expires} /> })}
              </>
            }
            amt={<Figure cell={x.value} />}
            href={`/app/packages?holding=${x.id}`}
          >
            <p className="app-line">{fill(a.holdingLine, { sessions: <Figure cell={x.sessions} />, value: <Figure cell={x.value} /> })}</p>
          </Row>
        ))}
      </Group>
    </Screen>
  );
}
