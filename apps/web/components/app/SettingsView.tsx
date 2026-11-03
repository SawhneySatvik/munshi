"use client";

// /app/settings (the owner's): the capabilities with their switches, the channels, the people and their sessions, the
// shop's look.
import { switchAction } from "../../app/app/settings/actions";
import { fill } from "../../lib/i18n";
import { APP, type AppDict, CAP_NAME, CHANNEL_REASON } from "../../lib/i18n-app";
import type { SettingsPage } from "../../lib/server/office";
import type { Lang } from "../../lib/types";
import { useLang } from "../LangProvider";
import { ActForm, Group, Name, Row, Screen, Tag, When } from "./Kit";
import { shopName } from "./OfficeParts";

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
      <Group id="channels-h" title={a.channelsHeading} note={a.channelsNote}>
        {data.channels.map((ch) => (
          <Row
            key={ch.channel}
            title={ch.channel === "whatsapp" ? a.channelWhatsapp : a.channelInstagram}
            sub={CHANNEL_REASON[ch.reason]?.[lang]}
            amt={<Tag tone={ch.live ? "ok" : "warn"}>{ch.live ? a.channelLive : a.channelRecorded}</Tag>}
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
