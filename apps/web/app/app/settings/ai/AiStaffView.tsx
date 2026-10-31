"use client";

// Settings → AI staff (P-5): one row per agent, its desk in plain words, what it does, the model alias that answers now
// and, for the owner, a picker of the aliases the platform allows for its role plus "Default" (the edition's). Everyone
// else sees the same rows read-only. An alias is a short name, never a provider's model id; nothing here is a figure.
import { ActForm, Field, Group, Row, Screen, Tag, When } from "../../../../components/app/Kit";
import { chooseModelAction } from "../actions";
import type { AiStaffPage } from "./data";

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
};

export function AiStaffView({ data }: { data: AiStaffPage }) {
  return (
    <Screen
      frame={data}
      id="ai-staff-h"
      kicker={`${data.shop} · Settings`}
      title="AI staff"
      lede={
        data.owner
          ? "Pick the model each desk uses, from the models the platform allows. A desk with no allowed model shows its plain template instead."
          : "The model each desk uses. Only the owner can change them."
      }
    >
      <Group id="ai-desks-h" title="Desks" empty="No desks.">
        {data.rows.map((r) => {
          const desk = DESK[r.agent] ?? { name: r.agent, does: "" };
          return (
            <Row
              key={r.agent}
              title={desk.name}
              sub={
                <>
                  {desk.does} · {r.current ? `Model: ${r.current}` : "No model allowed: hidden"}
                  {r.chosen && r.chosenAt ? (
                    <>
                      {" "}
                      · chosen <When at={r.chosenAt} />
                    </>
                  ) : null}
                </>
              }
              amt={r.chosen && r.chosen !== r.defaultAlias ? <Tag tone="ok">Chosen</Tag> : <Tag>Default</Tag>}
            >
              {data.owner && r.allowed.length > 0 ? (
                <ActForm action={chooseModelAction} formKey={data.formKey} tag={`model-${r.agent}`} submit="Use this model" inline label={`Model for ${desk.name}`}>
                  <input type="hidden" name="agent" value={r.agent} />
                  <Field label="Model">
                    <select name="alias" className="input" defaultValue={r.chosen && r.chosen !== r.defaultAlias ? r.chosen : "default"}>
                      <option value="default">Default{r.defaultAlias ? ` (${r.defaultAlias})` : ""}</option>
                      {r.allowed.map((a) => (
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
    </Screen>
  );
}
