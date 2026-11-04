"use client";

// /app/settings (the owner's): the capabilities with their switches, the channels, the people and their sessions, the
// shop's look. A channel row never writes: no per-channel switch exists, so WhatsApp and Instagram show the capability
// switch each follows and point to it, and Connect only says what connecting needs.
import { type ReactNode, useId, useState } from "react";
import { switchAction } from "../../app/app/settings/actions";
import { fill, fillText } from "../../lib/i18n";
import { APP, type AppDict, CAP_NAME, CHANNEL_REASON } from "../../lib/i18n-app";
import type { SettingsPage } from "../../lib/server/office";
import type { Lang } from "../../lib/types";
import { Button } from "../Button";
import { useLang } from "../LangProvider";
import { ActForm, Group, Name, Row, Screen, Tag, When } from "./Kit";
import { shopName } from "./OfficeParts";
import "./Channels.css";

const ROLE: Record<string, keyof AppDict> = { owner: "roleOwner", manager: "roleManager", staff: "roleStaff" };
const VIA: Record<string, keyof AppDict> = { demo: "viaDemo", sandbox: "viaSandbox", real: "viaReal" };
const capName = (code: string, lang: Lang) => CAP_NAME[code]?.[lang] ?? code;
const names = (codes: string[], lang: Lang) => codes.map((c) => capName(c, lang)).join(", ");

// The capability switch each channel's sends follow: replies and reminders under Messaging, posts under Campaigns.
const FOLLOWS: Record<string, string> = { whatsapp: "messaging", instagram: "campaigns" };
// A sample shop, or a deployment that sends nothing: a demo. Any other reason is a shop not connected yet.
const DEMO_REASONS = new Set(["sample_shop", "send_mode"]);

// Plain drawn marks for what each channel does; no platform's logo.
const GLYPH: Record<string, ReactNode> = {
  whatsapp: <path d="M4 5.5h16v11H10l-4.5 3.5v-3.5H4z" />,
  instagram: (
    <>
      <path d="M3.5 8H8l1.5-2.5h5L16 8h4.5v11h-17z" />
      <circle cx="12" cy="13" r="3.25" />
    </>
  ),
  facebook: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19c.5-3.5 2.5-5 5.5-5s5 1.5 5.5 5" />
      <path d="M15 5.8a3 3 0 0 1 0 5.4M17 14.3c2 .6 3.1 2.2 3.5 4.7" />
    </>
  ),
  google: (
    <>
      <path d="M5 11v8.5h14V11" />
      <path d="M3.5 10 5.5 4.5h13l2 5.5a3 3 0 0 1-5.67 1 3.3 3.3 0 0 1-5.66 0 3 3 0 0 1-5.67-1z" />
      <path d="M10 19.5V15h4v4.5" />
    </>
  ),
};

/** One channel: its mark and name, its state on the rail, why it stands so, Connect and the on/off state. */
function ChannelRow({ glyph, name, tag, sub, connected, on, state }: { glyph: string; name: string; tag: ReactNode; sub: ReactNode; connected: boolean; on: boolean; state: ReactNode }) {
  const { lang } = useLang();
  const a = APP[lang];
  const [asked, setAsked] = useState(false);
  const note = useId();
  return (
    <div className="l-row channel-row">
      <span className={`channel-mark channel-mark-${glyph}`}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          {GLYPH[glyph]}
        </svg>
      </span>
      <p className="app-title channel-name">{name}</p>
      <div className="l-amt channel-state">{tag}</div>
      <div className="channel-body">
        <p className="l-sub">{sub}</p>
        <div className="channel-acts">
          {!connected && (
            <Button aria-expanded={asked} aria-controls={asked ? note : undefined} aria-label={fillText(a.channelConnectFor, { name })} onClick={() => setAsked(!asked)}>
              {a.channelConnect}
            </Button>
          )}
          <span className="channel-switch">
            <button type="button" role="switch" aria-checked={on} aria-label={fillText(a.channelSwitch, { name, state: on ? a.capOn : a.capOff })} className="channel-toggle" disabled />
            <span className="l-sub">{state}</span>
          </span>
        </div>
        {asked && (
          <p id={note} className="channel-note">
            {fillText(a.channelConnectNote, { name })}
          </p>
        )}
      </div>
    </div>
  );
}

/** /app/settings (the owner's): the capabilities with their switches, the people and their sessions, the shop's look. */
export function SettingsView({ data }: { data: SettingsPage }) {
  const { lang } = useLang();
  const a = APP[lang];
  const isOn = (code: string) => data.capabilities.some((c) => c.code === code && c.on);
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
      <Group id="channels-h" title={a.channelsHeading} note={a.channelsNote}>
        {data.channels.map((ch) => {
          const capability = FOLLOWS[ch.channel] as string;
          const on = isOn(capability);
          return (
            <ChannelRow
              key={ch.channel}
              glyph={ch.channel}
              name={ch.channel === "whatsapp" ? a.channelWhatsapp : a.channelInstagram}
              sub={CHANNEL_REASON[ch.reason]?.[lang]}
              tag={<Tag tone={ch.live ? "ok" : "warn"}>{ch.live ? a.channelLive : DEMO_REASONS.has(ch.reason) ? a.channelRecorded : a.channelNotConnected}</Tag>}
              connected={ch.live}
              on={on}
              state={fill(a.channelFollows, { state: on ? a.capOn : a.capOff, capability: <a href="#caps-h">{capName(capability, lang)}</a> })}
            />
          );
        })}
        {(["facebook", "google"] as const).map((glyph) => (
          <ChannelRow
            key={glyph}
            glyph={glyph}
            name={glyph === "facebook" ? a.channelFacebook : a.channelGoogle}
            sub={a.channelOtherSub}
            tag={<Tag tone="warn">{a.channelNotConnectedDemo}</Tag>}
            connected={false}
            on={false}
            state={fill(a.channelNoSwitch, { state: a.capOff })}
          />
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
