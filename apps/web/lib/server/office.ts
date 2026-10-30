// The office screens' data (server only, BP-APP-3): the inbox, campaigns, settings and the morning brief, each read by
// its core view (views-office.ts) in the page's ONE transaction (page()). Null while the shop cannot use the screen (the
// inbox while messaging is switched off, campaigns while the shop cannot use them, settings for anyone but the owner),
// and the page answers 404. Every figure is a ref into a snapshot cell the view minted or read back: the order a message
// quotes (inbox.order_link), a campaign's audience (campaign.audience's row count) and the brief's order (brief.ranked's
// rank) and its lines' figures (the findings' own cells). The customer's words and the copy are text, never figures.
import { type CellRef, type Session, type StoredSnapshot, viewBrief, viewCampaigns, viewInbox, viewSettings } from "@munshi/core";
import type { Frame } from "../app-types";
import type { Localized, SourceRef } from "../types";
import { type Minted, mintedAs, page, textOf } from "./ops";
import { frameOf, lab } from "./sell";

/** A core cell ref (its stored row, 0-based) as the screen's ref (shown 1-based). */
const refOf = (r: CellRef, label: Localized): SourceRef => ({ label, snapshotId: r.snapshotId, row: r.row + 1, col: r.col });
const COUNT = "_count";

// ---- the inbox -------------------------------------------------------------------------------------------------------

export type InboxRow = {
  id: string;
  channel: string;
  kind: string;
  text: string | null;
  status: string;
  at: string;
  optOut: boolean;
  // The order requests the message quotes by code, read by inbox.order_link: how many matched (its row count) and each
  // one's code and state (an empty read: none matched). Null for a message that quotes no code.
  orders: { count: SourceRef; rows: { code: string; state: string }[] } | null;
};
export type InboxPage = Frame & { granted: boolean; messages: InboxRow[] };

export async function loadInbox(session: Session): Promise<InboxPage | null> {
  return page(session, async (c) => {
    const v = await viewInbox(c, session);
    if (!v) return null;
    const L = lab("inboxLinkLabel");
    const minted: Minted[] = [];
    const messages = v.messages.map((m): InboxRow => {
      const link = m.link ? mintedAs(m.link, L, ["code", "state"]) : null;
      if (link) minted.push(link);
      return {
        id: m.id,
        channel: m.channel,
        kind: m.kind,
        text: m.text,
        status: m.status,
        at: m.receivedAt,
        optOut: m.optOut,
        orders: link ? { count: { label: L, snapshotId: link.id, row: 1, col: COUNT }, rows: link.cells.map((r) => ({ code: textOf(r.code), state: textOf(r.state) })) } : null,
      };
    });
    return { ...frameOf(v.viewer, minted), granted: v.granted, messages };
  });
}

// ---- campaigns -------------------------------------------------------------------------------------------------------

export type CampaignRow = {
  id: string;
  name: string;
  channel: string;
  segment: string;
  status: string;
  offer: string | null;
  body: string | null;
  // How many it would reach: the row count of campaign.audience, read now while composing, else the one its draft cites.
  audience: SourceRef | null;
  draftId: string | null;
  draftStatus: string | null;
  at: string;
};
export type CampaignsPage = Frame & { granted: boolean; campaigns: CampaignRow[]; offers: { id: string; name: string }[] };

export async function loadCampaigns(session: Session): Promise<CampaignsPage | null> {
  return page(session, async (c) => {
    const v = await viewCampaigns(c, session);
    if (!v) return null;
    const L = lab("audienceLabel");
    const seen = new Map<string, Minted>();
    const add = (s: StoredSnapshot, title: Localized) => {
      if (!seen.has(s.id)) seen.set(s.id, mintedAs(s, title, s.query === "campaign.audience" ? ["customer"] : undefined));
    };
    for (const s of v.cited) add(s, s.query === "campaign.audience" ? L : lab("copyFigureLabel"));
    const campaigns = v.campaigns.map((k): CampaignRow => {
      if (k.audience) add(k.audience, L);
      const cited = k.cited.find((r) => r.col === COUNT);
      return {
        id: k.id,
        name: k.name,
        channel: k.channel,
        segment: k.segment,
        status: k.status,
        offer: k.offer,
        body: k.body,
        audience: k.audience ? { label: L, snapshotId: k.audience.id, row: 1, col: COUNT } : cited ? refOf(cited, L) : null,
        draftId: k.draftId,
        draftStatus: k.draftStatus,
        at: k.createdAt,
      };
    });
    return { ...frameOf(v.viewer, [...seen.values()]), granted: v.granted, campaigns, offers: v.offers };
  });
}

// ---- settings --------------------------------------------------------------------------------------------------------

export type SettingsPage = Frame & {
  capabilities: { code: string; on: boolean; usable: boolean; needsGrant: boolean; requires: string[]; requiredBy: string[] }[];
  members: { id: string; name: string; role: string; active: boolean }[];
  sessions: { id: string; member: string; via: string; at: string; until: string; mine: boolean }[];
  look: { tokens: [string, string][]; fontPair: string; at: string } | null;
  shops: { id: string; name: string }[];
};

export async function loadSettings(session: Session): Promise<SettingsPage | null> {
  return page(session, async (c) => {
    const v = await viewSettings(c, session);
    if (!v) return null;
    return {
      ...frameOf(v.viewer, []),
      capabilities: v.capabilities,
      members: v.members,
      sessions: v.sessions.map((s) => ({ id: s.id, member: s.member, via: s.via, at: s.createdAt, until: s.expiresAt, mine: s.mine })),
      look: v.look ? { tokens: Object.entries(v.look.tokens).filter(([k]) => k.startsWith("--")), fontPair: v.look.fontPair, at: v.look.createdAt } : null,
      shops: v.shops.map((s) => ({ id: s.id, name: s.name })),
    };
  });
}

// ---- the morning brief -----------------------------------------------------------------------------------------------

export type BriefLineRow = { findingId: string; kind: string; severity: string; rank: SourceRef; text: string; narrated: boolean; refs: SourceRef[] };
export type BriefPage = Frame & { briefs: { id: string; shop: string; day: string; at: string; lines: BriefLineRow[] }[] };

export async function loadBrief(session: Session): Promise<BriefPage> {
  return page(session, async (c) => {
    const v = await viewBrief(c, session);
    const rank = lab("briefRankLabel");
    const fig = lab("briefFigureLabel");
    const minted = v.snapshots.map((s) => (s.query === "brief.ranked" ? mintedAs(s, rank, ["rank", "kind", "severity", "days_open"]) : mintedAs(s, fig)));
    return {
      ...frameOf(v.viewer, minted),
      briefs: v.briefs.map((b) => ({
        id: b.id,
        shop: b.shop,
        day: b.day,
        at: b.createdAt,
        lines: b.lines.map((l) => ({
          findingId: l.findingId,
          kind: l.kind,
          severity: l.severity,
          rank: refOf(l.rank, rank),
          text: l.text,
          narrated: l.narrated,
          refs: l.refs.map((r) => refOf(r, fig)),
        })),
      })),
    };
  });
}
