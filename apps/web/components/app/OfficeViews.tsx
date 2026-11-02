"use client";

// BP-APP-3's screens: the inbox, campaigns, settings and the office's morning brief. A customer's words are theirs
// ([data-said]), a campaign's copy is the owner's words with its figures as refs, a brief line's figures are the
// findings' own cells; every number is a <Figure> of a stored cell. "Recorded · nothing is sent" stands on every screen
// whose messages would go out while the shop has no channel grant (every demo shop).
import { type ReactNode, useActionState } from "react";
import {
  decideCampaignAction,
  createCampaignAction,
  draftCopyAction,
  proposeCampaignAction,
  testSendAction,
  writeCopyAction,
} from "../../app/app/campaigns/actions";
import { draftOrderAction, draftReplyAction, handleMessageAction, hearAction } from "../../app/app/inbox/actions";
import { switchAction } from "../../app/app/settings/actions";
import type { AgentState as MoveState } from "../../lib/agent-types";
import { markOf, toMarks } from "../../lib/copy-marks";
import { fill } from "../../lib/i18n";
import { AGENTS } from "../../lib/i18n-agents";
import { APP, type AppDict, BRIEF_LINE, CAP_NAME } from "../../lib/i18n-app";
import type { BriefLineRow, BriefPage, CampaignRow, CampaignsPage, InboxPage, InboxRow, SettingsPage } from "../../lib/server/office";
import type { Lang, SourceRef } from "../../lib/types";
import { OPS } from "../../lib/i18n-ops";
import { Button } from "../Button";
import { FindingMoves } from "../FindingMoves";
import { useLang } from "../LangProvider";
import { OfficeScene } from "../office/OfficeScene";
import { ReadAloud } from "../ReadAloud";
import type { AgentId, AgentState } from "../office/types";
import { Figure } from "../shell/Figure";
import { ActForm, Field, Group, Label, Name, Row, Screen, Tag, When } from "./Kit";

const shopName = (shop: string) => <span data-name="">{shop}</span>;
type AgentAction = (prev: MoveState, form: FormData) => Promise<MoveState>;

/** "Recorded · nothing is sent" until the shop holds a live channel grant. */
const Channel = ({ granted }: { granted: boolean }) => {
  const { lang } = useLang();
  return <p className="app-note">{granted ? APP[lang].inboxLive : <Label>{APP[lang].inboxRecorded}</Label>}</p>;
};

// ---- the inbox -------------------------------------------------------------------------------------------------------

const KIND: Record<string, keyof AppDict> = { audio: "inboxVoice", image: "inboxImage", other: "inboxOther" };
const HANDLED: Record<string, keyof AppDict> = { new: "inboxNew", handled: "inboxHandled", ignored: "inboxIgnored" };

/** /app/inbox: what customers sent, the order a message quotes by its code, and the member's handle or ignore. */
export function InboxView({ data }: { data: InboxPage }) {
  const { lang } = useLang();
  const a = APP[lang];
  const waiting = data.messages.filter((m) => m.status === "new");
  const done = data.messages.filter((m) => m.status !== "new");
  return (
    <Screen
      frame={data}
      id="inbox-h"
      kicker={fill(a.inboxKicker, { shop: shopName(data.shop) })}
      title={a.inboxTitle}
      lede={a.inboxLede}
      aside={<Channel granted={data.granted} />}
    >
      <Group id="inbox-waiting" title={a.inboxWaiting} empty={a.inboxWaitingEmpty}>
        {waiting.map((m) => (
          <Message key={m.id} m={m} formKey={data.formKey} hears={data.member.role !== "staff"} />
        ))}
      </Group>
      <Group id="inbox-done" title={a.inboxDone} empty={a.inboxDoneEmpty}>
        {done.map((m) => (
          <Message key={m.id} m={m} formKey={data.formKey} hears={false} />
        ))}
      </Group>
    </Screen>
  );
}

function Message({ m, formKey, hears }: { m: InboxRow; formKey: string; hears: boolean }) {
  const { lang } = useLang();
  const a = APP[lang];
  const kind = KIND[m.kind];
  return (
    <Row
      title={
        <>
          {kind ? a[kind] : a.channelWhatsapp} · <When at={m.at} />
        </>
      }
      amt={<Tag tone={m.status === "new" ? "warn" : m.status === "handled" ? "ok" : "ink"}>{a[HANDLED[m.status] ?? "inboxNew"]}</Tag>}
    >
      {/* A voice note's words were heard by Munshi from a clip a person attached (simulated), not typed by the customer. */}
      {m.text && m.heard && (
        <p className="l-sub">
          <Label>{AGENTS[lang].heardLabel}</Label>
        </p>
      )}
      {m.text ? (
        <blockquote className="app-quote" data-said="" aria-label={m.heard ? AGENTS[lang].heardWords : a.inboxTheirWords}>
          {m.text}
        </blockquote>
      ) : (
        <p className="l-sub">{a.inboxNoText}</p>
      )}
      {m.orders && (
        <p className="app-line">
          {fill(a.inboxQuotes, { n: <Figure cell={m.orders.count} /> })}
          {m.orders.rows.map((o) => (
            <span key={o.code}>
              {" "}
              <Name>{o.code}</Name> <Tag>{o.state}</Tag>
            </span>
          ))}
          {m.orders.rows.length > 0 && (
            <>
              {" · "}
              <a href="/app/orders">{a.inboxOpenOrders}</a>
            </>
          )}
        </p>
      )}
      {m.optOut && <p className="l-sub">{a.inboxStop}</p>}
      {m.status === "new" && !m.optOut && (
        <div className="app-steps">
          <ActForm action={handleMessageAction} formKey={formKey} tag={`handled-${m.id.slice(-12)}`} submit={a.markHandled} inline primary>
            <input type="hidden" name="message" value={m.id} />
            <input type="hidden" name="status" value="handled" />
          </ActForm>
          <ActForm action={handleMessageAction} formKey={formKey} tag={`ignored-${m.id.slice(-12)}`} submit={a.markIgnored} inline>
            <input type="hidden" name="message" value={m.id} />
            <input type="hidden" name="status" value="ignored" />
          </ActForm>
        </div>
      )}
      {m.status === "new" && !m.optOut && <MessageMoves m={m} hears={hears} />}
    </Row>
  );
}

/** An agent move's form: the ids its children name, its submit, and the fixed note the action answers. */
function AgentForm({ action, submit, label, primary, children }: { action: AgentAction; submit: ReactNode; label?: string; primary?: boolean; children: ReactNode }) {
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

/** A new message's agent moves: a voice note with no words yet is heard first (the clip attached, simulated; an owner's
 *  or a manager's, `hears`); a message with words gets "Draft reply" and "Draft order", each a draft for approval, and
 *  neither again while the one drafted waits for a decision. */
function MessageMoves({ m, hears }: { m: InboxRow; hears: boolean }) {
  const { lang } = useLang();
  const g = AGENTS[lang];
  const id = <input type="hidden" name="message" value={m.id} />;
  if (!m.text) {
    if (m.kind !== "audio" || !hears) return null;
    return (
      <AgentForm action={hearAction} submit={g.hear} label={g.hear}>
        {id}
        <Field label={g.voiceFile} note={<Label>{g.voiceSimulated}</Label>}>
          <input type="file" name="audio" accept="audio/wav,.wav" className="input" required />
        </Field>
      </AgentForm>
    );
  }
  return (
    <div className="app-steps">
      {m.replyWaiting ? (
        <p className="l-sub">{g.replyAlready}</p>
      ) : (
        <AgentForm action={draftReplyAction} submit={g.draftReply} label={g.draftReply} primary>
          {id}
        </AgentForm>
      )}
      {m.orderWaiting ? (
        <p className="l-sub">
          {g.orderAlready} <a href="/app/orders">{OPS[lang].navOrders}</a>
        </p>
      ) : (
        <AgentForm action={draftOrderAction} submit={g.draftOrder} label={g.draftOrder}>
          {id}
        </AgentForm>
      )}
    </div>
  );
}

// ---- campaigns -------------------------------------------------------------------------------------------------------

const SEGMENT: Record<string, keyof AppDict> = { bought_within_days: "segBought", lapsed_regulars: "segLapsed", package_expiring: "segPackage" };
const STATUS: Record<string, keyof AppDict> = {
  composing: "statusComposing",
  proposed: "statusProposed",
  approved: "statusApproved",
  rejected: "statusRejected",
  sent: "statusSent",
};
const TOKEN = /⟨snap:([0-9a-f-]{36})·(\d{1,6})·([a-z_][a-z0-9_]{0,62})⟩/g;

/** A copy's words with each ref token shown as the figure of its cell (copy never carries a typed digit). */
function Copy({ body, label }: { body: string; label: SourceRef["label"] }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const t of body.matchAll(TOKEN)) {
    parts.push(body.slice(last, t.index));
    parts.push(<Figure key={t.index} cell={{ label, snapshotId: t[1] as string, row: Number(t[2]) + 1, col: t[3] as string }} />);
    last = (t.index ?? 0) + t[0].length;
  }
  parts.push(body.slice(last));
  return <blockquote className="app-quote">{parts}</blockquote>;
}

/** /app/campaigns: compose, words, a test to oneself, propose; the send runs only when the owner approves its draft. */
export function CampaignsView({ data }: { data: CampaignsPage }) {
  const { lang } = useLang();
  const a = APP[lang];
  return (
    <Screen
      frame={data}
      id="campaigns-h"
      kicker={fill(a.campaignsKicker, { shop: shopName(data.shop) })}
      title={a.campaignsTitle}
      lede={a.campaignsLede}
      aside={
        <>
          <Channel granted={data.granted} />
          <ActForm action={createCampaignAction} formKey={data.formKey} tag="create" title={a.newCampaign} submit={a.compose} primary>
            <Field label={a.campaignName}>
              <input name="name" className="input" required maxLength={80} autoComplete="off" />
            </Field>
            <Field label={a.channel}>
              <select name="channel" className="input" defaultValue="whatsapp">
                <option value="whatsapp">{a.channelWhatsapp}</option>
                <option value="instagram">{a.channelInstagram}</option>
              </select>
            </Field>
            <Field label={a.segment}>
              <select name="segment" className="input" defaultValue="lapsed_regulars">
                {Object.entries(SEGMENT).map(([v, k]) => (
                  <option key={v} value={v}>
                    {a[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={a.segmentDays}>
              <input name="days" className="input" inputMode="numeric" autoComplete="off" />
            </Field>
            <Field label={a.campaignOffer}>
              <select name="offer" className="input" defaultValue="">
                <option value="">{a.none}</option>
                {data.offers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
          </ActForm>
        </>
      }
    >
      <Group id="campaigns-list" title={a.campaignsHeading} empty={a.campaignsEmpty}>
        {data.campaigns.map((k) => (
          <CampaignLine key={k.id} k={k} formKey={data.formKey} />
        ))}
      </Group>
    </Screen>
  );
}

const copyLabel: SourceRef["label"] = { en: APP.en.copyFigureLabel, hi: APP.hi.copyFigureLabel };

/** A ref token as the screen's ref (its stored row shown 1-based); null for text that is not one. */
const cellOf = (token: string, label: SourceRef["label"]): SourceRef | null => {
  const t = new RegExp(`^${TOKEN.source}$`).exec(token);
  return t ? { label, snapshotId: t[1] as string, row: Number(t[2]) + 1, col: t[3] as string } : null;
};

function CampaignLine({ k, formKey }: { k: CampaignRow; formKey: string }) {
  const { lang } = useLang();
  const a = APP[lang];
  const g = AGENTS[lang];
  const marks = toMarks(k.body ?? "");
  const tag = k.id.slice(-12);
  const tone = k.status === "proposed" ? "warn" : k.status === "approved" || k.status === "sent" ? "ok" : "ink";
  return (
    <Row
      title={
        <>
          <Name>{k.name}</Name> <Tag tone={tone}>{a[STATUS[k.status] ?? "statusComposing"]}</Tag>
        </>
      }
      sub={
        <>
          {k.channel === "instagram" ? a.channelInstagram : a.channelWhatsapp} · {a[SEGMENT[k.segment] ?? "segLapsed"]}
          {k.offer && <> · {fill(a.offerNamed, { name: <Name>{k.offer}</Name> })}</>} · <When at={k.at} />
        </>
      }
      amt={k.audience && <Figure cell={k.audience} />}
    >
      {k.audience && (
        <p className="app-line">{fill(k.status === "composing" ? a.audienceLine : a.audienceCited, { n: <Figure cell={k.audience} /> })}</p>
      )}
      {k.body ? <Copy body={k.body} label={{ en: APP.en.copyFigureLabel, hi: APP.hi.copyFigureLabel }} /> : <p className="l-sub">{a.noCopy}</p>}
      {k.status === "composing" && (
        <>
          <AgentForm action={draftCopyAction} submit={g.writeCopy} label={g.writeCopy}>
            <input type="hidden" name="campaign" value={k.id} />
            <Field label={g.copyBrief}>
              <input name="brief" className="input" maxLength={400} defaultValue={k.name} required autoComplete="off" />
            </Field>
          </AgentForm>
          {/* Keyed by the stored words, so the field shows them again after Munshi writes or the owner saves. */}
          <ActForm key={k.body ?? ""} action={writeCopyAction} formKey={formKey} tag={`copy-${tag}`} submit={a.saveCopy} inline>
            <input type="hidden" name="campaign" value={k.id} />
            <input type="hidden" name="figures" value={JSON.stringify(marks.figures)} />
            <Field label={a.copy} note={marks.figures.length ? g.copyMarkNote : a.copyNote}>
              <textarea name="body" className="input" rows={3} maxLength={4000} defaultValue={marks.text} required />
            </Field>
            {marks.figures.length > 0 && (
              <p className="app-line">
                {g.copyFigures}:
                {marks.figures.map((token, i) => (
                  <span key={token}>
                    {" "}
                    {markOf(i)} <Figure cell={cellOf(token, copyLabel)} />
                  </span>
                ))}
              </p>
            )}
          </ActForm>
          {k.body && (
            <div className="app-steps">
              <ActForm action={testSendAction} formKey={formKey} tag={`test-${tag}`} submit={a.testSend} inline label={a.testNote}>
                <input type="hidden" name="campaign" value={k.id} />
              </ActForm>
              <ActForm action={proposeCampaignAction} formKey={formKey} tag={`propose-${tag}`} submit={a.propose} inline primary label={a.proposeNote}>
                <input type="hidden" name="campaign" value={k.id} />
              </ActForm>
            </div>
          )}
        </>
      )}
      {k.draftId && k.draftStatus === "proposed" && (
        <div className="app-steps">
          <ActForm action={decideCampaignAction} formKey={formKey} tag={`approve-${tag}`} submit={a.approve} inline primary>
            <input type="hidden" name="draft" value={k.draftId} />
            <input type="hidden" name="verdict" value="approved" />
          </ActForm>
          <ActForm action={decideCampaignAction} formKey={formKey} tag={`reject-${tag}`} submit={a.reject} inline>
            <input type="hidden" name="draft" value={k.draftId} />
            <input type="hidden" name="verdict" value="rejected" />
          </ActForm>
        </div>
      )}
      {k.draftStatus === "stale" && <p className="l-sub">{a.draftStale}</p>}
    </Row>
  );
}

// ---- settings --------------------------------------------------------------------------------------------------------

const ROLE: Record<string, keyof AppDict> = { owner: "roleOwner", manager: "roleManager", staff: "roleStaff" };
const VIA: Record<string, keyof AppDict> = { demo: "viaDemo", sandbox: "viaSandbox", real: "viaReal" };
const capName = (code: string, lang: Lang) => CAP_NAME[code]?.[lang] ?? code;
const names = (codes: string[], lang: Lang) => codes.map((c) => capName(c, lang)).join(", ");

/** /app/settings (the owner's): the capabilities with their switches, the people and their sessions, the shop's look. */
export function SettingsView({ data }: { data: SettingsPage }) {
  const { lang } = useLang();
  const a = APP[lang];
  return (
    <Screen wide frame={data} id="settings-h" kicker={fill(a.settingsKicker, { shop: shopName(data.shop) })} title={a.settingsTitle} lede={a.settingsLede}>
      <Group grid id="caps-h" title={a.capsHeading} note={a.capsNote}>
        {data.capabilities.map((c) => (
          <Row
            key={c.code}
            title={capName(c.code, lang)}
            sub={
              <>
                {c.requires.length > 0 && fill(a.capRequires, { list: names(c.requires, lang) })}
                {c.requires.length > 0 && c.requiredBy.length > 0 && " · "}
                {c.requiredBy.length > 0 && fill(a.capRequiredBy, { list: names(c.requiredBy, lang) })}
                {c.needsGrant && (c.requires.length > 0 || c.requiredBy.length > 0) && " · "}
                {c.needsGrant && a.capNeedsGrant}
              </>
            }
            amt={c.on ? <Tag tone={c.usable ? "ok" : "warn"}>{c.usable ? a.capOn : a.capWaiting}</Tag> : <Tag>{a.capOff}</Tag>}
          >
            <ActForm action={switchAction} formKey={data.formKey} tag={`switch-${c.code}`} submit={c.on ? a.switchOff : a.switchOn} inline label={capName(c.code, lang)}>
              <input type="hidden" name="capability" value={c.code} />
              <input type="hidden" name="on" value={c.on ? "false" : "true"} />
            </ActForm>
          </Row>
        ))}
      </Group>
      <Group id="people-h" title={a.peopleHeading}>
        {data.members.map((m) => (
          <Row key={m.id} title={<Name>{m.name}</Name>} amt={m.active ? <Tag>{a[ROLE[m.role] ?? "roleStaff"]}</Tag> : <Tag>{a.memberLeft}</Tag>} />
        ))}
      </Group>
      <Group id="sessions-h" title={a.sessionsHeading} empty={a.sessionsEmpty}>
        {data.sessions.map((s) => (
          <Row
            key={s.id}
            title={<Name>{s.member}</Name>}
            sub={
              <>
                {a[VIA[s.via] ?? "viaReal"]} · <When at={s.at} /> · {fill(a.sessionUntil, { at: <When at={s.until} /> })}
              </>
            }
            amt={s.mine && <Tag tone="ok">{a.thisSession}</Tag>}
          />
        ))}
      </Group>
      <Group id="look-h" title={a.lookHeading} note={a.lookNote} empty={a.lookEmpty}>
        {data.look && (
          <Row title={fill(a.lookAt, { at: <When at={data.look.at} /> })} sub={
              <>
                {a.lookFont}: <Name>{data.look.fontPair}</Name>
              </>
            }>
            <ul className="app-swatches">
              {data.look.tokens.map(([k, v]) => (
                <li key={k}>
                  {/^#|^rgb|^hsl|^oklch/.test(v) && <span className="app-swatch" style={{ background: v }} aria-hidden="true" />}
                  <Name>{k}</Name> <Name>{v}</Name>
                </li>
              ))}
            </ul>
          </Row>
        )}
      </Group>
    </Screen>
  );
}

// ---- the office: the morning brief -----------------------------------------------------------------------------------

const SEVERITY: Record<string, keyof AppDict> = { critical: "sevCritical", high: "sevHigh", medium: "sevMedium", low: "sevLow" };

/** A line's words with ⟦n⟧ (a narrated line) or {fig} (a fixed line) as the figure of its cell. */
function Words({ text, refs, slot }: { text: string; refs: SourceRef[]; slot: RegExp }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const t of text.matchAll(slot)) {
    parts.push(text.slice(last, t.index));
    parts.push(<Figure key={t.index} cell={refs[(Number(t[1]) || 1) - 1] ?? null} />);
    last = (t.index ?? 0) + t[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function BriefLine({ l }: { l: BriefLineRow }) {
  const { lang } = useLang();
  const a = APP[lang];
  const fixed = BRIEF_LINE[l.kind]?.[lang];
  const words = l.narrated ? (
    <Words text={l.text} refs={l.refs} slot={/⟦(\d+)⟧/g} />
  ) : fixed ? (
    <Words text={fixed} refs={l.refs} slot={/\{(fig)\}/g} />
  ) : (
    <Words text={l.text} refs={l.refs} slot={/⟦(\d+)⟧/g} />
  );
  return (
    <Row
      title={
        <>
          {fill(a.briefRank, { n: <Figure cell={l.rank} /> })} <Tag tone={l.severity === "critical" || l.severity === "high" ? "warn" : "ink"}>{a[SEVERITY[l.severity] ?? "sevLow"]}</Tag>
        </>
      }
      // Only a line in Munshi's own words says so; the group's note says the rest are in fixed words.
      sub={l.narrated ? a.briefNarrated : undefined}
    >
      <p className="app-line">{words}</p>
      <FindingMoves ids={[l.findingId]} why={l.why} fix={l.fix} quiet={l.quiet} />
    </Row>
  );
}

/** /app/office: each branch's latest morning brief, in the order brief.ranked's rank cells give. */
/** `desks` renders under the brief (the cast's cards and the run log); `states` is each cast member's state from its
 *  latest run (lib/cast.ts), idle when absent. */
export function BriefView({ data, desks, states }: { data: BriefPage; desks?: ReactNode; states?: Partial<Record<AgentId, AgentState>> }) {
  const { lang } = useLang();
  const a = APP[lang];
  return (
    <Screen frame={data} id="office-h" kicker={shopName(data.shop)} title={OPS[lang].navOffice} lede={a.officeLede} wide>
      <OfficeScene shop={data.shop} lang={lang} at={data.briefs[0]?.at ?? ""} briefWritten={data.briefs.length > 0} states={states} sample={false} briefId="brief-h" />
      <h2 id="brief-h" className="ops-h">
        {a.briefTitle}
      </h2>
      <p className="office-note">{a.briefLede}</p>
      {data.briefs.length === 0 && (
        <Group id="brief-none" title={a.briefTitle} empty={a.briefEmpty} />
      )}
      {data.briefs.map((b) => (
        <Group
          key={b.id}
          id={`brief-${b.id.slice(-12)}`}
          title={
            <>
              <Name>{b.shop}</Name> · <When at={`${b.day}T00:00:00Z`} day />
            </>
          }
          note={
            <>
              {fill(a.briefWritten, { at: <When at={b.at} /> })} · {a.briefTemplateNote}
              {b.lines.length > 0 && <ReadAloud kind="brief" id={b.id} />}
            </>
          }
          empty={a.briefNothing}
        >
          {b.lines.map((l) => (
            <BriefLine key={l.findingId} l={l} />
          ))}
        </Group>
      ))}
      {/* The cast's desks and the run log, after the brief they serve. */}
      {desks}
    </Screen>
  );
}
