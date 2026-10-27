import { createElement, Fragment, type ReactNode } from "react";
import type { Lang } from "./types";

export const LANG_COOKIE = "munshi_lang";

export function parseLang(value: string | undefined): Lang {
  return value === "hi" ? "hi" : "en";
}

// Every on-screen string. No digits here: numbers reach the screen only from snapshot cells (CLAUDE.md, the guarantee).
// `{name}` marks a slot that `fill` replaces with a value or an element.
const en = {
  syntheticData: "Synthetic data",
  language: "Language",
  briefKicker: "Morning brief · {when}",
  synthetic: "(synthetic)",
  lede: "Good morning, {name}. Here is what changed overnight, with the row behind every number.",
  ledeMark: "Nothing changes your books until you approve it.",
  briefHeading: "Morning brief",
  shelfGap: "Shelf gap",
  priceRise: "Price rise",
  overdueCredit: "Overdue credit",
  simulatedSupplier: "Simulated supplier",
  simulated: "Simulated",
  booksSay: "Books say {n}",
  shelfShows: "Shelf shows {n}",
  priceTitle: "{item} · {source}",
  priceLine: "{was} → {now} a unit",
  overdueLine: "{count} customers owe {owed} for more than {days} days",
  shelfPhotoAlt: "Shelf photo, {when}: red boxes mark the empty spaces",
  source: "source",
  cannotVerify: "Cannot verify",
  unverifiedLine: "{what}: {reason}, so Munshi shows no figure.",
  waitingForYou: "Waiting for you",
  reorder: "Reorder",
  draft: "Draft",
  reorderLine: "{qty} × {item} from {supplier} {sim}",
  draftWhy: "Drafted by Munshi from the shelf gap. Nothing is ordered until you approve.",
  approve: "Approve",
  reject: "Reject",
  approved: "Approved",
  rejected: "Rejected",
  approvedNote: "Recorded under your name. {supplier} is simulated, so nothing real is sent.",
  rejectedNote: "Nothing changed. The draft is closed.",
  resetMock: "Reset mock",
  askHi: "बोलकर पूछें",
  askEn: "Ask by voice",
  srcHeading: "Where this number comes from",
  srcRead: "read {when}",
  srcNote: "The highlighted cell is the number circled on your screen.",
  close: "Close",
  footer:
    "Demo on synthetic data. {shop}, its customers and its figures are made up; {supplier} is a simulated supplier. Payments are recorded, never processed.",
};

export type Dict = Record<keyof typeof en, string>;

const hi: Dict = {
  syntheticData: "सिंथेटिक डेटा",
  language: "भाषा",
  briefKicker: "सुबह का हाल · {when}",
  synthetic: "(सिंथेटिक)",
  lede: "सुप्रभात, {name}। रात में क्या बदला, हर संख्या के पीछे की पंक्ति के साथ।",
  ledeMark: "आपकी मंज़ूरी के बिना आपकी बही में कुछ नहीं बदलता।",
  briefHeading: "सुबह का हाल",
  shelfGap: "शेल्फ़ में कमी",
  priceRise: "दाम बढ़ा",
  overdueCredit: "बकाया उधार",
  simulatedSupplier: "सिम्युलेटेड सप्लायर",
  simulated: "सिम्युलेटेड",
  booksSay: "बही में {n}",
  shelfShows: "शेल्फ़ पर {n}",
  priceTitle: "{item} · {source}",
  priceLine: "{was} → {now} प्रति नग",
  overdueLine: "{count} ग्राहकों पर {owed} का उधार, {days} दिन से ज़्यादा से",
  shelfPhotoAlt: "शेल्फ़ की फ़ोटो, {when}: लाल डिब्बे खाली जगह दिखाते हैं",
  source: "स्रोत",
  cannotVerify: "पुष्टि नहीं हो सकती",
  unverifiedLine: "{what}: {reason}, इसलिए मुंशी कोई संख्या नहीं दिखाता।",
  waitingForYou: "आपकी मंज़ूरी बाकी",
  reorder: "दोबारा मँगाएँ",
  draft: "ड्राफ़्ट",
  reorderLine: "{supplier} {sim} से {qty} × {item}",
  draftWhy: "शेल्फ़ की कमी देखकर मुंशी ने बनाया। आपकी मंज़ूरी तक कुछ नहीं मँगाया जाएगा।",
  approve: "मंज़ूर करें",
  reject: "नामंज़ूर",
  approved: "मंज़ूर",
  rejected: "नामंज़ूर",
  approvedNote: "आपके नाम से दर्ज हुआ। {supplier} सिम्युलेटेड है, असल में कुछ नहीं भेजा गया।",
  rejectedNote: "कुछ नहीं बदला। ड्राफ़्ट बंद हो गया।",
  resetMock: "मॉक रीसेट करें",
  askHi: "बोलकर पूछें",
  askEn: "Ask by voice",
  srcHeading: "यह संख्या कहाँ से आई",
  srcRead: "{when}",
  srcNote: "हाइलाइट वाला खाना वही संख्या है जिस पर स्क्रीन में गोला लगा है।",
  close: "बंद करें",
  footer:
    "सिंथेटिक डेटा पर डेमो। {shop}, उसके ग्राहक और आँकड़े काल्पनिक हैं; {supplier} सिम्युलेटेड सप्लायर है। भुगतान सिर्फ़ दर्ज होते हैं, असल में नहीं होते।",
};

export const DICT: Record<Lang, Dict> = { en, hi };

/** Replaces each `{slot}` in a template; a slot the template names but the caller omits is a bug, so it throws. */
export function fill(template: string, slots: Record<string, ReactNode>): ReactNode[] {
  return template.split(/\{(\w+)\}/).map((part, i) => {
    if (i % 2 === 0) return part;
    if (!(part in slots)) throw new Error(`missing slot {${part}}`);
    return createElement(Fragment, { key: i }, slots[part]);
  });
}

/** The string form of `fill`, for attributes such as aria-label. */
export function fillText(template: string, slots: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = slots[name];
    if (value === undefined) throw new Error(`missing slot {${name}}`);
    return value;
  });
}
