"use client";

// Keeper's desk on the office: the notes in force, newest first, each with its words (a person's own, shown as
// typed or, on a live shop, with names kept as roles), its source chip (the decision's command, its verdict, who decided
// and when) and the date it holds until; the owner may forget one. The times are cells of memory.in_force.
import { useActionState } from "react";
import { type ForgetState, forgetAction } from "../../app/app/office/actions";
import { fill } from "../../lib/i18n";
import { MEMORY } from "../../lib/i18n-memory";
import type { KeeperData, KeeperNote } from "../../lib/server/memory";
import { Group, Name, Row, Tag, When } from "../app/Kit";
import { Button } from "../Button";
import { useLang } from "../LangProvider";
import { castAgents } from "./OfficeScene";

export function KeeperDesk({ data }: { data: KeeperData }) {
  const { lang } = useLang();
  const t = MEMORY[lang];
  const keeper = castAgents(lang).find((a) => a.id === "keeper");
  return (
    <Group
      id="keeper-h"
      title={
        <>
          {t.keeperTitle} {keeper && <Tag>{keeper.role}</Tag>}
        </>
      }
      note={data.recorded ? `${t.keeperNote} ${t.recordedNote}` : t.keeperNote}
      empty={t.keeperEmpty}
    >
      {data.notes.map((n) => (
        <NoteRow key={n.id} n={n} canForget={data.canForget} />
      ))}
    </Group>
  );
}

function NoteRow({ n, canForget }: { n: KeeperNote; canForget: boolean }) {
  const { lang } = useLang();
  const t = MEMORY[lang];
  const [state, action, pending] = useActionState<ForgetState, FormData>(forgetAction, null);
  const kind = n.kind === "declined" ? t.declined : n.kind === "preference" ? t.preference : t.note;
  return (
    <Row
      title={
        <>
          <Tag tone={n.kind === "declined" ? "warn" : "ok"}>{kind}</Tag> <q className="keeper-words">{n.words}</q>
        </>
      }
      sub={
        <span className="keeper-chip">
          {fill(t.source, {
            command: <Name>{n.command}</Name>,
            verdict: n.verdict === "approved" ? t.approved : t.rejected,
            who: <span data-name="">{n.decidedBy ?? t.someone}</span>,
            when: <When at={n.decidedAt} />,
          })}
          {" · "}
          {fill(t.holds, { when: <When at={n.validTo} /> })}
        </span>
      }
      amt={
        canForget && (
          <form action={action}>
            <input type="hidden" name="memory" value={n.id} />
            <Button type="submit" disabled={pending} aria-label={t.forgetLabel.replace("{words}", n.words)}>
              {t.forget}
            </Button>
          </form>
        )
      }
    >
      {state && "error" in state && (
        <p className="l-sub" role="status">
          {state.error === "gone" ? t.forgetGone : state.error === "refused" ? t.forgetError : t.forgetOther}
        </p>
      )}
    </Row>
  );
}
