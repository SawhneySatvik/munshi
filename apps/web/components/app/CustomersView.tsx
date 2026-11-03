"use client";

import Link from "next/link";
import { fill } from "../../lib/i18n";
import { APP } from "../../lib/i18n-app";
import type { CustomerPage, CustomersPage } from "../../lib/server/sell";
import { useLang } from "../LangProvider";
import { Figure } from "../shell/Figure";
import { Group, Name, Row, Screen } from "./Kit";

/** /app/customers: every customer by name, with what each owes on credit and the points each holds (cells). */
export function CustomersView({ data }: { data: CustomersPage }) {
  const { lang } = useLang();
  const a = APP[lang];
  return (
    <Screen
      frame={data}
      id="customers-h"
      kicker={fill(a.customersKicker, { shop: <span data-name="">{data.shop}</span> })}
      title={a.customersTitle}
      lede={a.customersLede}
    >
      <Group id="customers-list" title={a.customersHeading} empty={a.customersEmpty}>
        {data.customers.map((k) => (
          <Row
            key={k.id}
            title={<Name>{k.name}</Name>}
            href={`/app/customers/${k.id}`}
            sub={data.credit ? (k.owes ? fill(a.owes, { n: <Figure cell={k.owes} /> }) : a.owesNothing) : undefined}
            amt={k.points ? fill(a.points, { n: <Figure cell={k.points} /> }) : undefined}
          />
        ))}
      </Group>
    </Screen>
  );
}

/** /app/customers/[id]: one customer's credit balance, points and packages, each a cell of its read. */
export function CustomerView({ data }: { data: CustomerPage }) {
  const { lang } = useLang();
  const a = APP[lang];
  return (
    <Screen
      frame={data}
      id="customer-h"
      kicker={fill(a.customerKicker, { shop: <span data-name="">{data.shop}</span> })}
      title={<Name>{data.customer.name}</Name>}
      lede={a.customerLede}
    >
      {data.owes && (
        <Group id="credit-h" title={a.creditHeading}>
          <Row lead title={a.creditLabel} amt={<Figure cell={data.owes} />} />
        </Group>
      )}
      {data.points && (
        <Group id="loyal-h" title={a.pointsOne}>
          <Row lead title={fill(a.pointsWorth, { n: <Figure cell={data.points.n} />, v: <Figure cell={data.points.worth} /> })} />
        </Group>
      )}
      {data.holdings && (
        <Group id="held-h" title={a.packagesOne} empty={a.packagesOneEmpty}>
          {data.holdings.map((x) => (
            <Row
              key={x.id}
              title={<Name>{x.plan}</Name>}
              href={`/app/packages?holding=${x.id}`}
              sub={fill(a.holdingExpires, { day: <Figure cell={x.expires} /> })}
              amt={<Figure cell={x.value} />}
            >
              <p className="app-line">{fill(a.holdingLine, { sessions: <Figure cell={x.sessions} />, value: <Figure cell={x.value} /> })}</p>
            </Row>
          ))}
        </Group>
      )}
      <p>
        <Link href="/app/customers">{a.back}</Link>
      </p>
    </Screen>
  );
}
