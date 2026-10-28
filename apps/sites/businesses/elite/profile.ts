// Elite's site copy, written for this site. Elite's own tagline and Instagram text are not used (permission pending);
// the facts here are only what the brief gives: the name, two New Delhi branches, unisex services and an academy.
import type { Profile } from "../../lib/business.ts";

export const profile: Profile = {
  slug: "elite",
  kind: "salon",
  fullName: "Elite Unisex Salon & Academy",
  name: {
    en: { lead: "Elite", accent: "Salon & Academy", short: "Salon" },
    hi: { lead: "Elite", accent: "Salon & Academy", short: "Salon" },
  },
  pill: { en: "New Delhi · Kirti Nagar & Kalkaji · unisex", hi: "नई दिल्ली · कीर्ति नगर और कालकाजी · यूनिसेक्स" },
  sub: {
    en: "Hair, skin, nails and bridal, for women and men, at two Delhi branches.",
    hi: "महिलाओं और पुरुषों के लिए बाल, त्वचा, नाखून और ब्राइडल, दिल्ली की दो शाखाओं में।",
  },
  cta: {
    primary: { label: { en: "Book a visit", hi: "बुकिंग करें" }, href: "/book" },
    secondary: { label: { en: "See services", hi: "सेवाएँ देखें" }, href: "/services" },
  },
  headerCta: { label: { en: "Book a visit", hi: "बुकिंग करें" }, href: "/book" },
  nav: [
    { label: { en: "Services", hi: "सेवाएँ" }, href: "/services" },
    { label: { en: "Packages", hi: "पैकेज" }, href: "/packages" },
    { label: { en: "Our story", hi: "हमारी कहानी" }, href: "/story" },
  ],
  categories: [
    { id: "hair", label: { en: "Hair", hi: "बाल" }, blurb: { en: "Cuts, colour, keratin and hair spa.", hi: "कटिंग, कलर, केराटिन और हेयर स्पा।" } },
    { id: "skin", label: { en: "Skin", hi: "त्वचा" }, blurb: { en: "Clean-ups, facials, de-tan and threading.", hi: "क्लीन-अप, फ़ेशियल, डी-टैन और थ्रेडिंग।" } },
    { id: "nails", label: { en: "Nails", hi: "नाखून" }, blurb: { en: "Manicures, pedicures, gel and nail art.", hi: "मैनीक्योर, पेडीक्योर, जेल और नेल आर्ट।" } },
    { id: "spa", label: { en: "Spa", hi: "स्पा" }, blurb: { en: "Head, body and foot massage.", hi: "सिर, बदन और पैरों की मालिश।" } },
    { id: "grooming", label: { en: "Men's grooming", hi: "पुरुषों की ग्रूमिंग" }, blurb: { en: "Cuts, beard shaping, shaves and facials.", hi: "कटिंग, दाढ़ी की शेप, शेव और फ़ेशियल।" } },
    { id: "bridal", label: { en: "Bridal", hi: "ब्राइडल" }, blurb: { en: "Bridal, engagement and party make-up.", hi: "दुल्हन, सगाई और पार्टी मेकअप।" } },
  ],
  marquee: [
    { en: "Hair", hi: "बाल" },
    { en: "Skin", hi: "त्वचा" },
    { en: "Nails", hi: "नाखून" },
    { en: "Spa", hi: "स्पा" },
    { en: "Men's grooming", hi: "पुरुषों की ग्रूमिंग" },
    { en: "Bridal", hi: "ब्राइडल" },
    { en: "The academy", hi: "अकैडमी" },
    { en: "Confirmed on WhatsApp", hi: "पुष्टि WhatsApp पर" },
  ],
  copy: {
    shop: { en: "Elite", hi: "Elite" },
    footerLine: {
      en: "A unisex salon and academy with two branches in New Delhi: Kirti Nagar and Kalkaji.",
      hi: "नई दिल्ली में दो शाखाओं वाला यूनिसेक्स सैलून और अकैडमी: कीर्ति नगर और कालकाजी।",
    },
    branchesTitle: { en: "Pick your branch", hi: "अपनी शाखा चुनें" },
    branchCta: { en: "Book at {branch}", hi: "{branch} में बुक करें" },
    taking: { en: "Taking requests", hi: "अनुरोध ले रहे हैं" },
    paused: { en: "Call the branch for now", hi: "अभी शाखा को फ़ोन करें" },
    confirms: { en: "Confirms on WhatsApp", hi: "पुष्टि WhatsApp पर" },
    servicesTitle: { en: "Something for every visit", hi: "हर बार के लिए कुछ ख़ास" },
    servicesLine: { en: "Every service on the menu shows its time and price.", hi: "मेन्यू में हर सेवा का समय और दाम लिखा है।" },
    packagesTitle: { en: "Packages & memberships", hi: "पैकेज और मेंबरशिप" },
    packagesLine: { en: "Pay once and come back through the weeks. Ask about any of them at either branch.", hi: "एक बार भुगतान करें और हफ़्तों तक आते रहें। किसी भी शाखा में पूछें।" },
    packagesCta: { en: "See all packages", hi: "सारे पैकेज देखें" },
    offersTitle: { en: "This season", hi: "इस मौसम में" },
    servicesPageTitle: { en: "Services", hi: "सेवाएँ" },
    servicesPageLine: {
      en: "The same menu at both branches. Add up to three services, then send a booking request.",
      hi: "दोनों शाखाओं में एक ही मेन्यू। तीन तक सेवाएँ जोड़ें, फिर बुकिंग का अनुरोध भेजें।",
    },
    packagesPageLine: {
      en: "Prepaid packs and yearly memberships. Each one is used at either branch.",
      hi: "पहले से भुगतान वाले पैक और सालाना मेंबरशिप। हर एक दोनों शाखाओं में चलता है।",
    },
    packagesHeading: { en: "Packages", hi: "पैकेज" },
    membershipsHeading: { en: "Memberships", hi: "मेंबरशिप" },
    planCta: { en: "Ask about this", hi: "इसके बारे में पूछें" },
    planNote: { en: "About the {plan}", hi: "{plan} के बारे में" },
    bookTitle: { en: "Book a visit", hi: "बुकिंग करें" },
    bookLine: { en: "Tell us when suits you. Elite confirms the exact time on WhatsApp.", hi: "बताइए कब ठीक रहेगा। Elite सही समय WhatsApp पर पक्का करेगा।" },
  },
  story: {
    pill: { en: "Our story", hi: "हमारी कहानी" },
    title: {
      en: { lead: "A salon for everyone,", accent: "and a school for stylists" },
      hi: { lead: "सबके लिए सैलून,", accent: "और स्टाइलिस्ट के लिए स्कूल" },
    },
    body: [
      {
        en: "Elite is a unisex salon with two branches in New Delhi, one in Kirti Nagar and one in Kalkaji. Women and men come in for hair, skin, nails, spa and grooming, and brides come in for the biggest day of all.",
        hi: "Elite नई दिल्ली में दो शाखाओं वाला यूनिसेक्स सैलून है, एक कीर्ति नगर में और एक कालकाजी में। महिलाएँ और पुरुष बाल, त्वचा, नाखून, स्पा और ग्रूमिंग के लिए आते हैं, और दुल्हनें अपने सबसे बड़े दिन के लिए।",
      },
      {
        en: "Elite is also an academy that trains new stylists. Ask at either branch about courses. This page will carry the owners' own story, in their words, once they send it.",
        hi: "Elite एक अकैडमी भी है जो नए स्टाइलिस्ट तैयार करती है। कोर्स के बारे में किसी भी शाखा में पूछें। मालिकों की अपनी कहानी, उनके शब्दों में, आते ही यहाँ होगी।",
      },
    ],
    promises: [
      {
        icon: "chat",
        title: { en: "Confirmed on WhatsApp", hi: "पुष्टि WhatsApp पर" },
        body: { en: "Send a request with a day and a time of day. The branch replies on WhatsApp with your slot.", hi: "दिन और समय बताकर अनुरोध भेजें। शाखा WhatsApp पर आपका स्लॉट बताएगी।" },
      },
      {
        icon: "tag",
        title: { en: "Prices you can see", hi: "दाम साफ़ दिखते हैं" },
        body: { en: "Every service shows its time and price before you ask.", hi: "पूछने से पहले हर सेवा का समय और दाम दिखता है।" },
      },
      {
        icon: "everyone",
        title: { en: "Women and men", hi: "महिलाएँ और पुरुष" },
        body: { en: "One menu for everyone, with grooming for men and bridal for the season.", hi: "सबके लिए एक मेन्यू, पुरुषों के लिए ग्रूमिंग और शादी के मौसम के लिए ब्राइडल।" },
      },
    ],
    close: {
      icon: "academy",
      title: { en: "Learning the craft?", hi: "हुनर सीखना है?" },
      body: { en: "The academy trains new stylists. Ask at either branch about the next batch.", hi: "अकैडमी नए स्टाइलिस्ट तैयार करती है। अगले बैच के बारे में किसी भी शाखा में पूछें।" },
      cta: { label: { en: "Book a visit", hi: "बुकिंग करें" }, href: "/book" },
    },
  },
  whatsapp: null,
};
