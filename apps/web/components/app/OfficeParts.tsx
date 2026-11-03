"use client";

// Pieces the office screens share: the shop's name as the books spell it, the channels' live-or-recorded note, and an
// agent move's form.
import type { ChannelState } from "@munshi/core";
import { type ReactNode, useActionState } from "react";
import type { AgentState as MoveState } from "../../lib/agent-types";
import { fill } from "../../lib/i18n";
import { AGENTS } from "../../lib/i18n-agents";
import { APP } from "../../lib/i18n-app";
import { Button } from "../Button";
import { useLang } from "../LangProvider";
import { Label } from "./Kit";

export const shopName = (shop: string) => <span data-name="">{shop}</span>;
type AgentAction = (prev: MoveState, form: FormData) => Promise<MoveState>;

/** "Recorded · nothing is sent" while no channel sends for real (core's channelState: every demo shop); else each
 *  channel as it is, live or recorded, so a screen never says "sent" for a channel whose sends are only recorded. */
export const Channel = ({ channels }: { channels: ChannelState[] }) => {
  const { lang } = useLang();
  const a = APP[lang];
  if (!channels.some((ch) => ch.live)) {
    return (
      <p className="app-note">
        <Label>{a.inboxRecorded}</Label>
      </p>
    );
  }
  const name = (ch: ChannelState) => (ch.channel === "instagram" ? a.channelInstagram : a.channelWhatsapp);
  return (
    <p className="app-note">
      {channels.map((ch, i) => (
        <span key={ch.channel}>
          {i > 0 && " · "}
          {ch.live ? (ch.channel === "instagram" ? a.instagramLive : a.inboxLive) : <Label>{fill(a.channelNotLive, { name: name(ch) })}</Label>}
        </span>
      ))}
    </p>
  );
};

/** An agent move's form: the ids its children name, its submit, and the fixed note the action answers. */
export function AgentForm({ action, submit, label, primary, children }: { action: AgentAction; submit: ReactNode; label?: string; primary?: boolean; children: ReactNode }) {
  const { lang } = useLang();
  const g = AGENTS[lang];
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="act act-inline" aria-label={label}>
      {children}
      <Button type="submit" variant={primary ? "primary" : "secondary"} disabled={pending}>
        {pending ? g.working : submit}
      </Button>
      <div role="status" className="act-status">
        {state && "note" in state && <p className={state.ok ? "act-done" : "l-sub"}>{g[state.note]}</p>}
      </div>
    </form>
  );
}
