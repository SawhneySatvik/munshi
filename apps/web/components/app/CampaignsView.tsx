"use client";

// /app/campaigns: a campaign's copy is the owner's words with its figures as refs, every number a <Figure> of a stored
// cell. "Recorded · nothing is sent" stands while no channel of the shop sends for real (every demo shop).
import { type ReactNode, useState } from "react";
import {
  attachCardAction,
  decideCampaignAction,
  createCampaignAction,
  draftCopyAction,
  proposeCampaignAction,
  removeCardAction,
  testSendAction,
  writeCopyAction,
} from "../../app/app/campaigns/actions";
import { cardForUpload } from "../../lib/card-upload";
import { markOf, toMarks } from "../../lib/copy-marks";
import { fill } from "../../lib/i18n";
import { AGENTS } from "../../lib/i18n-agents";
import { APP, type AppDict } from "../../lib/i18n-app";
import type { CampaignRow, CampaignsPage } from "../../lib/server/office";
import type { SourceRef } from "../../lib/types";
import { FeatureGate } from "../AiFeatures";
import { useLang } from "../LangProvider";
import { Figure } from "../shell/Figure";
import { ActForm, Field, Group, Name, Row, Screen, Tag, When } from "./Kit";
import { AgentForm, Channel, shopName } from "./OfficeParts";

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
          <Channel channels={data.channels} />
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
          <CampaignLine key={k.id} k={k} formKey={data.formKey} cardStore={data.cardStore} />
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

function CampaignLine({ k, formKey, cardStore }: { k: CampaignRow; formKey: string; cardStore: boolean }) {
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
      {k.channel === "instagram" && <CampaignCard k={k} formKey={formKey} tag={tag} cardStore={cardStore} />}
      {k.status === "composing" && (
        <>
          <FeatureGate feature="campaign_copy">
            <AgentForm action={draftCopyAction} submit={g.writeCopy} label={g.writeCopy}>
              <input type="hidden" name="campaign" value={k.id} />
              <Field label={g.copyBrief}>
                <input name="brief" className="input" maxLength={400} defaultValue={k.name} required autoComplete="off" />
              </Field>
            </AgentForm>
          </FeatureGate>
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

/** The card's file input: the picked picture is scaled down and made a JPEG on this device (lib/card-upload.ts) before
 *  the form may send it; one still over the cap is cleared, with the reason, and never sent. */
function CardInput() {
  const { lang } = useLang();
  const a = APP[lang];
  const [tooBig, setTooBig] = useState(false);
  const pick = async (input: HTMLInputElement) => {
    setTooBig(false);
    const file = input.files?.[0];
    if (!file) return;
    input.setCustomValidity(a.cardPreparing);
    const ready = await cardForUpload(file);
    if (!ready) {
      input.value = "";
      setTooBig(true);
    } else if (ready !== file) {
      try {
        const files = new DataTransfer();
        files.items.add(ready);
        input.files = files.files;
      } catch {
        // No DataTransfer here: the file goes as picked, and the server's cap still holds.
      }
    }
    input.setCustomValidity("");
  };
  return (
    <>
      <input type="file" name="card" accept="image/jpeg,image/png" className="input" required onChange={(e) => void pick(e.currentTarget)} />
      {tooBig && <span className="ops-error">{a.cardTooBig}</span>}
    </>
  );
}

/** An Instagram post's picture: shown to the composer and to the approver (the card the draft bound), attached,
 *  replaced or removed only while composing, and only where a media store takes uploads (else the screen says why). */
function CampaignCard({ k, formKey, tag, cardStore }: { k: CampaignRow; formKey: string; tag: string; cardStore: boolean }) {
  const { lang } = useLang();
  const a = APP[lang];
  return (
    <div className="campaign-card" data-card={k.card ?? ""}>
      {k.card ? (
        <figure>
          {/* biome-ignore lint/performance/noImgElement: the shop's own card from its private route (no-store), which next/image cannot optimise. */}
          <img src={`/api/office/cards/${k.card}.jpg`} alt={a.cardAlt} width={160} loading="lazy" />
          {k.status !== "composing" && <figcaption className="l-sub">{a.cardBound}</figcaption>}
        </figure>
      ) : (
        <p className="l-sub">{a.noCard}</p>
      )}
      {k.status === "composing" &&
        (cardStore ? (
          <div className="app-steps">
            <ActForm action={attachCardAction} formKey={formKey} tag={`card-${tag}`} submit={k.card ? a.replaceCard : a.attachCard} inline>
              <input type="hidden" name="campaign" value={k.id} />
              <Field label={a.card} note={a.cardNote}>
                <CardInput />
              </Field>
            </ActForm>
            {k.card && (
              <ActForm action={removeCardAction} formKey={formKey} tag={`uncard-${tag}`} submit={a.removeCard} inline>
                <input type="hidden" name="campaign" value={k.id} />
              </ActForm>
            )}
          </div>
        ) : (
          <p className="l-sub">{a.cardNoStore}</p>
        ))}
    </div>
  );
}
