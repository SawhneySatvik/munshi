"use client";

// Settings → AI staff (P-5): one row per agent, its desk in plain words, what it does, the model alias that answers now
// and, for the owner, a picker of the aliases the shop may use for its role plus "Default" (the shop's, else the
// edition's). Everyone else sees the same rows read-only. An alias is a short name, never a provider's model id.
// The router per shop (D-079 §8): a desk whose list the operator set for this shop says so, and the AI features show as
// the operator set them. Spend (W1-C), for the office's roles: this month against the budget and by desk, every figure a
// <Figure> of a stored cell; a cost with no price reads "Cannot verify", never zero. Past most of the budget a banner
// says so; once it is all spent, that calls stop.
import { CannotVerify } from "../../../../components/CannotVerify";
import { ActForm, Field, Group, Name, Row, Screen, Tag, When } from "../../../../components/app/Kit";
import { useLang } from "../../../../components/LangProvider";
import { MuseCredit } from "../../../../components/pwa/MuseCredit";
import { Figure } from "../../../../components/shell/Figure";
import { ROUTER, type RouterDict } from "../../../../lib/i18n-router";
import { chooseModelAction } from "../actions";
import type { AiStaffPage, SpendPart } from "./data";

// The desks as a shopkeeper would name them (ref.ai_agent's agents).
const DESK: Record<string, { name: string; does: string }> = {
  ask: { name: "Ask Munshi", does: "Answers your questions from the books, every figure traced to a row." },
  counter: { name: "Counter helper", does: "Helps at the counter with quick sales and lookups." },
  bills: { name: "Bill reader", does: "Reads a supplier's bill photo into a purchase draft for you to approve." },
  shelf: { name: "Shelf counter", does: "Counts stock on a shelf photo into a count draft for you to approve." },
  voice: { name: "Voice", does: "Turns a spoken question or voice note into words." },
  brief: { name: "Morning brief", does: "Writes the morning brief's lines from the day's findings." },
  chat_to_order: { name: "Chat to order", does: "Turns a customer's chat message into an order draft." },
  campaigns: { name: "Campaigns", does: "Writes campaign copy for you to review before anything is sent." },
  replies: { name: "Replies", does: "Drafts replies to customer messages for you to send." },
  settlements: { name: "Settlements", does: "Explains gaps between a payment statement and your recorded receipts." },
  speak: { name: "Read aloud", does: "Reads an answer or the morning brief aloud, word for word as checked." },
};
// A run's desk as the spend ledger files it (lib/server/agent-port.ts's), by its name on this page.
const RUN_DESK: Record<string, string> = { stock: "Shelf counter", recipe: "Draft the fix", inbox: "Inbox", surplus: "Offer it" };
const deskName = (desk: string) => DESK[desk]?.name ?? RUN_DESK[desk] ?? desk;

export function AiStaffView({ data }: { data: AiStaffPage }) {
  const { lang } = useLang();
  const r = ROUTER[lang];
  return (
    <Screen
      wide
      frame={data}
      id="ai-staff-h"
      kicker={`${data.shop} · Settings`}
      title="AI staff"
      aside={<MuseCredit />}
      lede={
        data.owner
          ? "Pick the model each desk uses, from the models this shop may use. A desk with no allowed model shows its plain template instead."
          : "The model each desk uses. Only the owner can change them."
      }
    >
      {data.spend && data.spend.state !== "under" ? (
        <p className="ops-error" role="status" data-spend-state={data.spend.state}>
          {data.spend.state === "hard" ? r.hard : r.soft}
        </p>
      ) : null}
      <Group grid id="ai-desks-h" title="Desks" empty="No desks.">
        {data.rows.map((row) => {
          const desk = DESK[row.agent] ?? { name: row.agent, does: "" };
          return (
            <Row
              key={row.agent}
              title={desk.name}
              sub={
                <>
                  {desk.does} · {row.current ? `Model: ${row.current}` : "No model allowed: hidden"}
                  {row.source === "shop" ? <> · {r.listShop}</> : null}
                  {row.chosen && row.chosenAt ? (
                    <>
                      {" "}
                      · chosen <When at={row.chosenAt} />
                    </>
                  ) : null}
                </>
              }
              amt={row.chosen && row.chosen !== row.defaultAlias ? <Tag tone="ok">Chosen</Tag> : <Tag>Default</Tag>}
            >
              {data.owner && row.allowed.length > 0 ? (
                <ActForm action={chooseModelAction} formKey={data.formKey} tag={`model-${row.agent}`} submit="Use this model" inline label={`Model for ${desk.name}`}>
                  <input type="hidden" name="agent" value={row.agent} />
                  <Field label="Model">
                    <select name="alias" className="input" defaultValue={row.chosen && row.chosen !== row.defaultAlias ? row.chosen : "default"}>
                      <option value="default">Default{row.defaultAlias ? ` (${row.defaultAlias})` : ""}</option>
                      {row.allowed.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </Field>
                </ActForm>
              ) : null}
            </Row>
          );
        })}
      </Group>
      <Group grid id="ai-features-h" title={r.featuresTitle} note={r.featuresNote}>
        {data.features.map(({ feature, state }) => (
          <Row
            key={feature}
            title={r[`feature_${feature}` as keyof RouterDict]}
            amt={
              state.on ? (
                <Tag tone="ok">{r.featureOn}</Tag>
              ) : (
                <Tag tone="warn">
                  <span data-switched-off={state.why === "switched_off" ? feature : undefined}>{state.why === "switched_off" ? r.switchedOff : r.featureAiOff}</span>
                </Tag>
              )
            }
          />
        ))}
      </Group>
      {data.spend ? <Spend spend={data.spend} r={r} /> : null}
    </Screen>
  );
}

function Spend({ spend, r }: { spend: SpendPart; r: RouterDict }) {
  return (
    <Group
      id="ai-spend-h"
      title={r.spendTitle}
      note={
        <>
          {r.spendNote}
          {spend.recorded ? <> {r.spendRecorded}</> : null}
        </>
      }
    >
      <Row title={r.budget} amt={spend.budget ? <Figure cell={spend.budget} /> : <span>{r.noBudget}</span>} />
      {spend.budget ? (
        <Row
          title={r.spent}
          amt={
            <span data-slot="spent">
              <Figure cell={spend.spent} />
              {/* The total leaves out calls it cannot price: it is not the whole month's spend. */}
              {spend.partial ? (
                <>
                  {" "}
                  <CannotVerify />
                </>
              ) : null}
            </span>
          }
        />
      ) : null}
      <Row title={r.calls} amt={<Figure cell={spend.calls} />} />
      <Row title={r.unpriced} amt={<Figure cell={spend.unpriced} />} />
      <Row title={r.byDesk} sub={spend.desks.length ? null : r.byDeskEmpty}>
        {spend.desks.length ? (
          <dl className="desk-counts" data-slot="spend-by-desk">
            {spend.desks.map((d) => (
              <div key={`${d.desk}-${d.alias}`}>
                <dt>
                  {deskName(d.desk)} · <Name>{d.alias}</Name>
                  {d.estimate ? <Tag>{r.estimate}</Tag> : null}
                </dt>
                <dd>
                  <Figure cell={d.calls} /> · {d.cost ? <Figure cell={d.cost} /> : <CannotVerify />}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Row>
    </Group>
  );
}
