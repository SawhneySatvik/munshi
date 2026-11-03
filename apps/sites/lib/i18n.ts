import type { Lang, Text } from "./business.ts";

export const LANGS: Lang[] = ["en", "hi"];

export function isLang(v: string): v is Lang {
  return v === "en" || v === "hi";
}

/** English is served without a prefix (proxy.ts rewrites it to /en); Hindi lives under /hi. */
export function href(lang: Lang, path: string): string {
  if (!path.startsWith("/")) return path;
  const localized = lang === "en" ? path : path === "/" ? "/hi" : `/hi${path}`;
  const basePath = process.env.NEXT_PUBLIC_MUNSHI_SITES_BASE_PATH ?? "";
  return basePath && !localized.startsWith(`${basePath}/`) && localized !== basePath ? `${basePath}${localized}` : localized;
}

export function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

/** Strings every business shares. Business copy lives in its profile; figures come only from the API. */
export const ui = {
  // Shown only on a copy built as a sample (lib/variant.ts): the banner, the wordmark's suffix and the forms' note.
  bannerBadge: { en: "Sample site", hi: "नमूना साइट" },
  sampleSite: { en: "sample site", hi: "नमूना साइट" },
  bannerLine: {
    en: "Synthetic data from Munshi's demo: every price is a sample, and what you send is stored with a sample name and number, never yours.",
    hi: "Munshi के डेमो का नमूना डेटा: हर दाम नमूना है, और आप जो भेजते हैं वह नमूना नाम और नंबर के साथ रखा जाता है, आपका नहीं।",
  },
  menu: { en: "Menu", hi: "मेन्यू" },
  home: { en: "Home", hi: "होम" },
  switchTo: { en: "हिंदी", hi: "English" },
  switchLabel: { en: "पेज हिंदी में पढ़ें", hi: "Read this page in English" },
  errorTitle: { en: "Something went wrong", hi: "कुछ गड़बड़ हो गई" },
  errorBody: { en: "The shop's page could not be read just now. Try again, or go back home.", hi: "दुकान का पेज अभी पढ़ा नहीं जा सका। फिर कोशिश करें, या होम पर लौटें।" },
  tryAgain: { en: "Try again", hi: "फिर कोशिश करें" },
  notFoundTitle: { en: "We can't find that page", hi: "यह पेज नहीं मिला" },
  notFoundBody: { en: "The link may be old or mistyped.", hi: "लिंक पुराना या गलत लिखा हो सकता है।" },
  loadingPage: { en: "Loading", hi: "लोड हो रहा है" },
  privacy: { en: "Privacy notice", hi: "निजता सूचना" },
  builtWith: { en: "Runs on Munshi", hi: "Munshi पर चलता है" },
  fromBooks: { en: "Every price is read from the shop's published books. Tap “source” to see the row.", hi: "हर दाम दुकान के छपे खातों से पढ़ा जाता है। पंक्ति देखने के लिए “स्रोत” दबाएँ।" },

  source: { en: "source", hi: "स्रोत" },
  sourceOf: { en: "Where {what} comes from", hi: "{what} कहाँ से आया" },
  sourceChecking: { en: "Checking the books…", hi: "खाते देख रहे हैं…" },
  sourceRow: { en: "Published {when} from {table}, row", hi: "{when} को {table} से छपा, पंक्ति" },
  sourceCells: { en: "Worked out from these published figures:", hi: "इन छपे आँकड़ों से निकाला गया:" },
  sourceClose: { en: "Close", hi: "बंद करें" },
  cannotVerify: { en: "Cannot verify", hi: "जाँच नहीं हो सकती" },

  inclGst: { en: "GST included", hi: "GST सहित" },
  minutes: { en: "{n} min", hi: "{n} मिनट" },
  sessions: { en: "{n} sessions", hi: "{n} बार" },
  validDays: { en: "use within {n} days", hi: "{n} दिन में इस्तेमाल करें" },
  percentOff: { en: "{n}% off", hi: "{n}% कम" },
  amountOff: { en: "{amount} off", hi: "{amount} कम" },
  minSpend: { en: "on {amount} or more", hi: "{amount} या ज़्यादा पर" },
  code: { en: "Code", hi: "कोड" },
  until: { en: "till {when}", hi: "{when} तक" },
  offerAtShop: { en: "The shop checks the offer when it confirms.", hi: "पुष्टि करते समय दुकान ऑफ़र जाँचेगी।" },
  noneYet: { en: "Nothing published here yet.", hi: "यहाँ अभी कुछ छपा नहीं है।" },
  closed: { en: "Closed", hi: "बंद" },
  hours: { en: "Hours", hi: "समय" },
  days: {
    en: "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
    hi: "सोम,मंगल,बुध,गुरु,शुक्र,शनि,रवि",
  },

  name: { en: "Your name", hi: "आपका नाम" },
  phone: { en: "Mobile number", hi: "मोबाइल नंबर" },
  note: { en: "Anything else? (optional)", hi: "कुछ और? (ज़रूरी नहीं)" },
  whatsappUpdates: { en: "Send me updates about this on WhatsApp", hi: "इसकी जानकारी WhatsApp पर भेजें" },
  privacyLine: { en: "Your name and number are used only to answer this.", hi: "आपका नाम और नंबर सिर्फ़ इसके जवाब के लिए है।" },
  demoForm: {
    en: "Sample site: the demo stores a sample name and number in place of yours.",
    hi: "नमूना साइट: डेमो आपके नाम और नंबर की जगह नमूना रखता है।",
  },
  errName: { en: "Enter your name.", hi: "अपना नाम लिखें।" },
  errPhone: { en: "Enter a mobile number of 10 digits or more.", hi: "10 या ज़्यादा अंकों का मोबाइल नंबर लिखें।" },
  sending: { en: "Sending…", hi: "भेज रहे हैं…" },
  reference: { en: "Reference", hi: "संदर्भ" },

  refused_slot_taken: { en: "That time was just taken. Pick another.", hi: "यह समय अभी किसी ने ले लिया। दूसरा चुनें।" },
  refused_hold_limit: { en: "You already hold a time. Finish or release it first.", hi: "आपने पहले से एक समय रोका है। पहले उसे पूरा करें या छोड़ें।" },
  refused_intake_paused: { en: "The shop is not taking requests just now.", hi: "दुकान अभी अनुरोध नहीं ले रही।" },
  refused_rate_limited: { en: "Too many tries from here. Wait a little and try again.", hi: "यहाँ से बहुत कोशिशें हुईं। थोड़ा रुककर फिर कोशिश करें।" },
  refused_stale_notice: { en: "The shop's notice changed. Reload the page and send again.", hi: "दुकान की सूचना बदल गई। पेज फिर से खोलकर भेजें।" },
  refused_not_found: { en: "This is not available on the site just now.", hi: "यह अभी साइट पर उपलब्ध नहीं है।" },
  refused_invalid: { en: "The shop could not take this. Check it and try again.", hi: "दुकान इसे नहीं ले सकी। जाँचकर फिर कोशिश करें।" },
  refused_other: { en: "Could not reach the shop. Try again: the same request is sent, never a second one.", hi: "दुकान तक नहीं पहुँच सके। फिर कोशिश करें: वही अनुरोध जाएगा, दूसरा नहीं।" },
  noKey: { en: "This copy of the site takes no requests (it has no key).", hi: "साइट की यह प्रति अनुरोध नहीं लेती (इसकी कुंजी नहीं है)।" },
} satisfies Record<string, Text>;

export type UiKey = keyof typeof ui;

/** The fixed copy for an API refusal: a server's own text never reaches the page. */
export function refusal(code: string | undefined, lang: Lang): string {
  const key = `refused_${code}` as UiKey;
  return (key in ui ? ui[key] : ui.refused_other)[lang];
}
