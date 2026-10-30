"use client";

import { setRuleAction } from "../../app/app/loyalty/actions";
import { fill } from "../../lib/i18n";
import { APP } from "../../lib/i18n-app";
import type { LoyaltyPage } from "../../lib/server/sell";
import { useLang } from "../LangProvider";
import { Figure } from "../shell/Figure";
import { ActForm, Field, Group, Name, Row, Screen, When } from "./Kit";

/** /app/loyalty: the rule in effect (cells of loyalty.rule) and every customer's points (loyalty.balances). */
export function LoyaltyView({ data }: { data: LoyaltyPage }) {
  const { lang } = useLang();
  const a = APP[lang];
  const r = data.rule;
  return (
    <Screen
      frame={data}
      id="loyalty-h"
      kicker={fill(a.loyaltyKicker, { shop: <span data-name="">{data.shop}</span> })}
      title={a.loyaltyTitle}
      lede={a.loyaltyLede}
      aside={
        data.may.includes("loyalty.rule.set") ? (
          <ActForm action={setRuleAction} formKey={data.formKey} tag="rule" title={a.ruleSet} submit={a.ruleSubmit} primary>
            <Field label={a.ruleEarnField}>
              <input name="earn" className="input" inputMode="numeric" required autoComplete="off" />
            </Field>
            <Field label={a.ruleValueField}>
              <input name="value" className="input" inputMode="decimal" required autoComplete="off" />
            </Field>
            <Field label={a.ruleMinField}>
              <input name="min" className="input" inputMode="numeric" required autoComplete="off" />
            </Field>
          </ActForm>
        ) : (
          <p className="field-note">{a.ownerOnly}</p>
        )
      }
    >
      <Group id="rule-h" title={a.ruleHeading} empty={a.ruleEmpty}>
        {r && (
          <Row
            lead
            title={fill(a.ruleEarn, { n: <Figure cell={r.earn} /> })}
            sub={
              <>
                {fill(a.ruleValue, { v: <Figure cell={r.value} /> })} · {fill(a.ruleMin, { n: <Figure cell={r.min} /> })}
                {r.since && <> · {fill(a.ruleSince, { at: <When at={r.since} day /> })}</>}
              </>
            }
          />
        )}
      </Group>
      <Group id="points-h" title={a.pointsHeading} empty={a.pointsEmpty}>
        {data.holders.map((h) => (
          <Row key={h.id} title={<Name>{h.name}</Name>} href={`/app/customers/${h.id}`} amt={fill(a.points, { n: <Figure cell={h.points} /> })} />
        ))}
      </Group>
    </Screen>
  );
}
