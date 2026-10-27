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
  noBrief: "Morning brief · no watcher run yet",
  synthetic: "(synthetic)",
  lede: "Good morning, {name}. Here is what changed overnight, with the row behind every number.",
  ledeMark: "Nothing changes your books until you approve it.",
  briefHeading: "Morning brief",
  moreFindings: "{n} more findings",
  fewerFindings: "Show fewer",
  shelfGap: "Shelf gap",
  priceRise: "Price rise",
  overdueCredit: "Overdue credit",
  expiring: "Expiring soon",
  shortSettlement: "Short settlement",
  simulatedSupplier: "Simulated supplier",
  simulated: "Simulated",
  booksSay: "Books say {n}",
  shelfShows: "Shelf shows {n}",
  priceTitle: "{item} · {source}",
  priceLine: "{was} → {now} a unit",
  overdueLine: "{count} customers owe {owed} for more than {days} days",
  expiryLine: "{left} left, expiring in {days} days",
  expiryRisk: "{value} at risk of going to waste",
  shortLine: "UPI for {day} settled {short} short",
  labelStockLedger: "Stock ledger",
  labelStockCount: "Stock count",
  labelEarlierBills: "Earlier bills",
  labelSupplierBill: "{supplier} bill",
  labelCreditBook: "Credit book",
  labelPurchaseBill: "Purchase bill",
  labelUpiSettlement: "UPI settlement",
  titleShrinkage: "Stock counts short of the books",
  titlePriceCreep: "Bill prices above their usual",
  titleExpiry: "Stock expiring within a week",
  titleOverdue: "Customer credit (udhaar) · overdue",
  titleShortSettlement: "UPI settlements short of receipts",
  shelfPhotoAlt: "Shelf photo, {when}: red boxes mark the empty spaces",
  source: "source",
  cannotVerify: "Cannot verify",
  unverifiedLine: "{what}: {reason}, so Munshi shows no figure.",
  waitingForYou: "Waiting for you",
  reorder: "Reorder",
  draft: "Draft",
  reorderLine: "{lines} from {supplier} {sim}",
  reorderItem: "{qty} × {item}",
  draftWhy: "Drafted by Munshi from the shelf gap. Nothing is ordered until you approve.",
  approve: "Approve",
  reject: "Reject",
  approved: "Approved",
  rejected: "Rejected",
  stale: "Stale",
  failed: "Failed",
  approvedNote: "Recorded in the books under this name. {supplier} is simulated, so nothing real is sent.",
  rejectedNote: "Nothing changed. The draft is closed.",
  staleNote: "The figures behind this draft changed before it was approved, so nothing was ordered.",
  failedNote: "Nothing was ordered.",
  waitsForApprover: "Waiting for someone allowed to approve it.",
  errRefused: "Your role cannot decide this draft. Nothing changed.",
  errNotProposed: "This draft has already been decided.",
  errSignedOut: "Please sign in again. Nothing changed.",
  errOther: "Something went wrong. Nothing changed.",
  askHi: "बोलकर पूछें",
  askEn: "Ask by voice",
  srcHeading: "Where this number comes from",
  srcRead: "read {when}",
  srcNote: "The highlighted cell is the number circled on your screen.",
  close: "Close",
  footer:
    "Demo on synthetic data. {shop}, its customers and its figures are made up; its suppliers are simulated. Payments are recorded, never processed.",
  signedInAs: "Signed in as {name} · {role}.",
  switchPerson: "Switch person",
  roleOwner: "Owner",
  roleManager: "Manager",
  roleStaff: "Counter staff",
  signInTitle: "Who is using Munshi?",
  signInLede: "Demo sign-in: pick a person. They are synthetic, so there is no password.",
  signInNoShop: "The demo shop is not set up. Start the app with pnpm dev.",
};

export type Dict = Record<keyof typeof en, string>;

const hi: Dict = {
  syntheticData: "सिंथेटिक डेटा",
  language: "भाषा",
  briefKicker: "सुबह का हाल · {when}",
  noBrief: "सुबह का हाल · अभी कोई जाँच नहीं चली",
  synthetic: "(सिंथेटिक)",
  lede: "सुप्रभात, {name}। रात में क्या बदला, हर संख्या के पीछे की पंक्ति के साथ।",
  ledeMark: "आपकी मंज़ूरी के बिना आपकी बही में कुछ नहीं बदलता।",
  briefHeading: "सुबह का हाल",
  moreFindings: "{n} और निष्कर्ष",
  fewerFindings: "कम दिखाएँ",
  shelfGap: "शेल्फ़ में कमी",
  priceRise: "दाम बढ़ा",
  overdueCredit: "बकाया उधार",
  expiring: "जल्द एक्सपायर",
  shortSettlement: "कम सेटलमेंट",
  simulatedSupplier: "सिम्युलेटेड सप्लायर",
  simulated: "सिम्युलेटेड",
  booksSay: "बही में {n}",
  shelfShows: "शेल्फ़ पर {n}",
  priceTitle: "{item} · {source}",
  priceLine: "{was} → {now} प्रति नग",
  overdueLine: "{count} ग्राहकों पर {owed} का उधार, {days} दिन से ज़्यादा से",
  expiryLine: "{left} बचे, {days} दिन में एक्सपायर",
  expiryRisk: "{value} का माल बर्बाद होने का ख़तरा",
  shortLine: "{day} का UPI {short} कम सेटल हुआ",
  labelStockLedger: "स्टॉक बही",
  labelStockCount: "स्टॉक गिनती",
  labelEarlierBills: "पुराने बिल",
  labelSupplierBill: "{supplier} का बिल",
  labelCreditBook: "उधार खाता",
  labelPurchaseBill: "खरीद बिल",
  labelUpiSettlement: "UPI सेटलमेंट",
  titleShrinkage: "बही से कम निकली गिनती",
  titlePriceCreep: "सामान्य से ऊँचे बिल के दाम",
  titleExpiry: "हफ़्ते भर में एक्सपायर होने वाला माल",
  titleOverdue: "ग्राहक उधार · बकाया",
  titleShortSettlement: "रसीदों से कम आए UPI सेटलमेंट",
  shelfPhotoAlt: "शेल्फ़ की फ़ोटो, {when}: लाल डिब्बे खाली जगह दिखाते हैं",
  source: "स्रोत",
  cannotVerify: "पुष्टि नहीं हो सकती",
  unverifiedLine: "{what}: {reason}, इसलिए मुंशी कोई संख्या नहीं दिखाता।",
  waitingForYou: "आपकी मंज़ूरी बाकी",
  reorder: "दोबारा मँगाएँ",
  draft: "ड्राफ़्ट",
  reorderLine: "{supplier} {sim} से {lines}",
  reorderItem: "{qty} × {item}",
  draftWhy: "शेल्फ़ की कमी देखकर मुंशी ने बनाया। आपकी मंज़ूरी तक कुछ नहीं मँगाया जाएगा।",
  approve: "मंज़ूर करें",
  reject: "नामंज़ूर",
  approved: "मंज़ूर",
  rejected: "नामंज़ूर",
  stale: "पुराना",
  failed: "विफल",
  approvedNote: "इसी नाम से बही में दर्ज हुआ। {supplier} सिम्युलेटेड है, असल में कुछ नहीं भेजा गया।",
  rejectedNote: "कुछ नहीं बदला। ड्राफ़्ट बंद हो गया।",
  staleNote: "मंज़ूरी से पहले इस ड्राफ़्ट के पीछे के आँकड़े बदल गए, इसलिए कुछ नहीं मँगाया गया।",
  failedNote: "कुछ नहीं मँगाया गया।",
  waitsForApprover: "मंज़ूरी दे सकने वाले का इंतज़ार है।",
  errRefused: "आपकी भूमिका यह ड्राफ़्ट तय नहीं कर सकती। कुछ नहीं बदला।",
  errNotProposed: "यह ड्राफ़्ट पहले ही तय हो चुका है।",
  errSignedOut: "कृपया फिर से साइन इन करें। कुछ नहीं बदला।",
  errOther: "कुछ गड़बड़ हुई। कुछ नहीं बदला।",
  askHi: "बोलकर पूछें",
  askEn: "Ask by voice",
  srcHeading: "यह संख्या कहाँ से आई",
  srcRead: "{when}",
  srcNote: "हाइलाइट वाला खाना वही संख्या है जिस पर स्क्रीन में गोला लगा है।",
  close: "बंद करें",
  footer:
    "सिंथेटिक डेटा पर डेमो। {shop}, उसके ग्राहक और आँकड़े काल्पनिक हैं; उसके सप्लायर सिम्युलेटेड हैं। भुगतान सिर्फ़ दर्ज होते हैं, असल में नहीं होते।",
  signedInAs: "{name} · {role} के रूप में साइन इन।",
  switchPerson: "व्यक्ति बदलें",
  roleOwner: "मालिक",
  roleManager: "मैनेजर",
  roleStaff: "काउंटर स्टाफ़",
  signInTitle: "मुंशी कौन इस्तेमाल कर रहा है?",
  signInLede: "डेमो साइन-इन: एक व्यक्ति चुनें। ये सिंथेटिक हैं, इसलिए पासवर्ड नहीं है।",
  signInNoShop: "डेमो दुकान तैयार नहीं है। ऐप pnpm dev से शुरू करें।",
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
