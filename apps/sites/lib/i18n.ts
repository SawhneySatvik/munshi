import type { Lang, Link, Text } from "./business.ts";

export const LANGS: Lang[] = ["en", "hi"];

export function isLang(v: string): v is Lang {
  return v === "en" || v === "hi";
}

/** English is served without a prefix (proxy.ts rewrites it to /en); Hindi lives under /hi. */
export function href(lang: Lang, path: string): string {
  if (lang === "en" || !path.startsWith("/")) return path;
  return path === "/" ? "/hi" : `/hi${path}`;
}

/** Where a profile link goes in this language; outside links open in a new tab. */
export function linkProps(link: Link, lang: Lang): { href: string; target?: string; rel?: string } {
  const to = typeof link.href === "string" ? href(lang, link.href) : link.href[lang];
  return to.startsWith("http") ? { href: to, target: "_blank", rel: "noopener" } : { href: to };
}

export function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

/** "1 hr 15 min" / "1 घंटा 15 मिनट". */
export function duration(minutes: number, lang: Lang): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const parts: string[] = [];
  if (h) parts.push(lang === "hi" ? `${h} घंटा` : `${h} hr`);
  if (m || !h) parts.push(lang === "hi" ? `${m} मिनट` : `${m} min`);
  return parts.join(" ");
}

/** Strings every business shares. Business-specific copy lives in its profile. */
export const ui = {
  ribbonBadge: { en: "Sample data", hi: "नमूना डेटा" },
  ribbonShort: { en: "Sample site — nothing is sent.", hi: "नमूना साइट — कुछ भेजा नहीं जाता।" },
  ribbonLong: {
    en: "Sample site — prices are illustrative and requests are not sent to the shop.",
    hi: "नमूना साइट — दाम उदाहरण के लिए हैं और अनुरोध दुकान तक नहीं जाते।",
  },
  menu: { en: "Menu", hi: "मेन्यू" },
  closeMenu: { en: "Close menu", hi: "मेन्यू बंद करें" },
  home: { en: "Home", hi: "होम" },
  switchTo: { en: "हिंदी", hi: "English" },
  switchLabel: { en: "पेज हिंदी में पढ़ें", hi: "Read this page in English" },
  pricesFromBooks: { en: "Prices from the shop's books", hi: "दाम दुकान के अपने खातों से" },
  sampleForNow: { en: "sample prices for now", hi: "अभी नमूना दाम" },
  samplePrices: { en: "Sample prices", hi: "नमूना दाम" },
  sampleOffers: { en: "Sample offers", hi: "नमूना ऑफ़र" },
  sampleOffer: { en: "Sample offer", hi: "नमूना ऑफ़र" },
  samplePricesNote: {
    en: "Sample prices until the shop publishes its own from its books.",
    hi: "दुकान अपने खातों से दाम छापे, तब तक ये नमूना दाम हैं।",
  },
  privacy: { en: "Privacy notice", hi: "निजता सूचना" },
  builtWith: { en: "Built with Munshi", hi: "Munshi से बना" },
  demoFooter: {
    en: "Sample site: prices are illustrative, and nothing you send reaches the shop.",
    hi: "नमूना साइट: दाम उदाहरण भर हैं, और आपका भेजा कुछ भी दुकान तक नहीं पहुँचता।",
  },
  from: { en: "From {price}", hi: "{price} से" },
  add: { en: "Add {name}", hi: "{name} जोड़ें" },
  remove: { en: "Remove {name}", hi: "{name} हटाएँ" },
  added: { en: "Added", hi: "जुड़ गया" },
  inclGst: { en: "Inclusive of GST", hi: "GST सहित" },
  standIn: { en: "Drawing · the shop's photo goes here", hi: "चित्र · यहाँ दुकान की फ़ोटो आएगी" },
  standInShort: { en: "Drawing · photo soon", hi: "चित्र · फ़ोटो जल्द" },
  sessions: { en: "{n} sessions", hi: "{n} बार" },
  session: { en: "1 session", hi: "1 बार" },
  validFor: { en: "Use within {n} days", hi: "{n} दिन में इस्तेमाल करें" },
  validYear: { en: "Valid for a year", hi: "एक साल तक मान्य" },
  until: { en: "Till {when}", hi: "{when} तक" },
  whatToExpect: { en: "What to expect", hi: "क्या उम्मीद करें" },

  count1: { en: "1 service", hi: "1 सेवा" },
  countN: { en: "{n} services", hi: "{n} सेवाएँ" },
  requestBooking: { en: "Request booking", hi: "बुकिंग का अनुरोध" },
  trayFull: { en: "That's three: one request holds up to three services.", hi: "तीन हो गईं: एक अनुरोध में तीन तक सेवाएँ।" },
  trayShow: { en: "See list", hi: "सूची देखें" },
  trayHide: { en: "Hide list", hi: "सूची छिपाएँ" },

  back: { en: "Back", hi: "वापस" },
  stepBranch: { en: "Branch", hi: "शाखा" },
  stepWhen: { en: "Day and time", hi: "दिन और समय" },
  stepYou: { en: "Your details", hi: "आपकी जानकारी" },
  yourServices: { en: "Your services", hi: "आपकी सेवाएँ" },
  noServices: { en: "No services chosen yet.", hi: "अभी कोई सेवा नहीं चुनी।" },
  chooseServices: { en: "Choose from the menu", hi: "मेन्यू से चुनें" },
  changeServices: { en: "Add or change services", hi: "सेवाएँ जोड़ें या बदलें" },
  askingAbout: { en: "Asking about", hi: "इसके बारे में पूछ रहे हैं" },
  day: { en: "Day", hi: "दिन" },
  timeOfDay: { en: "Time of day", hi: "समय" },
  today: { en: "Today", hi: "आज" },
  tomorrow: { en: "Tomorrow", hi: "कल" },
  anotherDay: { en: "Another day", hi: "कोई और दिन" },
  pickDate: { en: "Pick a date", hi: "तारीख़ चुनें" },
  morning: { en: "Morning", hi: "सुबह" },
  afternoon: { en: "Afternoon", hi: "दोपहर" },
  evening: { en: "Evening", hi: "शाम" },
  yourName: { en: "Your name", hi: "आपका नाम" },
  phone: { en: "Mobile number", hi: "मोबाइल नंबर" },
  phoneHint: { en: "10 digits, starting with 6, 7, 8 or 9", hi: "10 अंक, 6, 7, 8 या 9 से शुरू" },
  note: { en: "Anything else? (optional)", hi: "कुछ और? (ज़रूरी नहीं)" },
  consent: { en: "Send me updates and offers from {shop} on WhatsApp", hi: "{shop} से अपडेट और ऑफ़र WhatsApp पर भेजें" },
  consentHint: {
    en: "Optional. Left unticked, you hear only about this booking.",
    hi: "ज़रूरी नहीं। बिना टिक किए आपको सिर्फ़ इस बुकिंग की बात मिलेगी।",
  },
  privacyLine: { en: "Your name and number are used only to answer this request.", hi: "आपका नाम और नंबर सिर्फ़ इस अनुरोध के जवाब के लिए है।" },
  demoForm: {
    en: "Sample site · what you type is not stored or sent to the shop",
    hi: "नमूना साइट · आप जो लिखेंगे, वह न रखा जाएगा, न दुकान को भेजा जाएगा",
  },
  send: { en: "Send request", hi: "अनुरोध भेजें" },
  sending: { en: "Sending…", hi: "भेज रहे हैं…" },
  confirmsOn: { en: "{shop} confirms your time on WhatsApp.", hi: "{shop} आपका समय WhatsApp पर पक्का करेगा।" },
  errBranch: { en: "Choose a branch.", hi: "शाखा चुनें।" },
  errServices: { en: "Add at least one service, or ask about a package.", hi: "कम से कम एक सेवा जोड़ें, या किसी पैकेज के बारे में पूछें।" },
  errDay: { en: "Choose a day.", hi: "दिन चुनें।" },
  errDate: { en: "Pick a day from today to 60 days ahead.", hi: "आज से 60 दिन के अंदर का दिन चुनें।" },
  errTime: { en: "Choose a time of day.", hi: "समय चुनें।" },
  errName: { en: "Enter your name.", hi: "अपना नाम लिखें।" },
  errPhone: { en: "Enter a 10-digit mobile number starting with 6, 7, 8 or 9.", hi: "6, 7, 8 या 9 से शुरू होने वाला 10 अंकों का मोबाइल नंबर लिखें।" },
  errSummary: { en: "A few details are missing. They're marked below.", hi: "कुछ जानकारी बाकी है, नीचे दिखाई गई है।" },
  sentTitle: { en: "Request sent", hi: "अनुरोध भेज दिया" },
  sentDemo: { en: "Sample site: nothing was stored or sent to the shop.", hi: "नमूना साइट: कुछ न रखा गया, न दुकान को भेजा गया।" },
  sentRef: { en: "Reference {id}", hi: "संदर्भ {id}" },
  backHome: { en: "Back to home", hi: "होम पर लौटें" },
  another: { en: "Make another request", hi: "एक और अनुरोध" },
  colour: { en: "Colour", hi: "रंग" },
  size: { en: "Size", hi: "साइज़" },
  fabric: { en: "Fabric", hi: "कपड़ा" },
} satisfies Record<string, Text>;
