"use client";

// /app/chat-link: a member's one-time code for the staff group, and the links they hold. The code is shown once, here
// only: it is kept as a hash, so no later page can show it again.
import { useActionState } from "react";
import { issueCodeAction, revokeLinkAction } from "../../app/app/chat-link/actions";
import { CHAT } from "../../lib/i18n-chat";
import { Button } from "../Button";
import { useLang } from "../LangProvider";
import { PageHead } from "../PageHead";
import { Group, Row, When } from "./Kit";

export function ChatLinkView({ links }: { links: { id: string; linkedAt: string; expiresAt: string }[] }) {
  const { lang } = useLang();
  const w = CHAT[lang];
  const [state, issue, pending] = useActionState(issueCodeAction, null);
  return (
    <main className="wrap ops app-screen">
      <PageHead id="chat-link" kicker={w.kicker} title={w.title} lede={w.lede} />
      <Group id="chat-code" title={w.codeHeading} note={w.codeNote}>
        <form action={issue} className="l-row">
          <Button type="submit" disabled={pending}>
            {w.getCode}
          </Button>
          {state && "code" in state && (
            <p className="app-title">
              <code>link {state.code}</code>
            </p>
          )}
          {state && "error" in state && <p role="alert">{w.codeFailed}</p>}
        </form>
      </Group>
      <Group id="chat-links" title={w.linksHeading} empty={w.noLinks}>
        {links.map((l) => (
          <Row
            key={l.id}
            title={w.linkedAccount}
            sub={
              <>
                {w.linkedOn} <When at={l.linkedAt} day />, {w.until} <When at={l.expiresAt} day />
              </>
            }
          >
            <form action={revokeLinkAction}>
              <input type="hidden" name="id" value={l.id} />
              <Button type="submit">{w.end}</Button>
            </form>
          </Row>
        ))}
      </Group>
    </main>
  );
}
