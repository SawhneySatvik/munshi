// Elite's site copy (look: elite-A "Matte black & champagne", D-057, with D-047's light mode). Written for this site:
// Elite's own tagline, logo and photographs are not used (permission pending), so the wordmark says "sample site" and
// the demo banner stays. The menu, prices, durations, packages and stylists all come from the API (the sample menu).
import type { Profile } from "../../lib/business.ts";

export const profile: Profile = {
  slug: "elite",
  kind: "salon",
  wordmark: { en: "Elite", hi: "एलीट", sub: { en: "Unisex Salon & Academy · sample site", hi: "यूनिसेक्स सैलून और अकैडमी · नमूना साइट" } },
  modes: true,
  nav: [
    { label: { en: "Services", hi: "सेवाएँ" }, href: "/services" },
    { label: { en: "Packages", hi: "पैकेज" }, href: "/packages", cap: "packages" },
    { label: { en: "Book a visit", hi: "बुकिंग करें" }, href: "/book", cap: "bookings" },
  ],
  categories: {
    hair: { label: { en: "Hair", hi: "बाल" }, blurb: { en: "Cuts, colour, keratin and hair spa.", hi: "कटिंग, कलर, केराटिन और हेयर स्पा।" } },
    skin: { label: { en: "Skin", hi: "त्वचा" }, blurb: { en: "Clean-ups, facials, de-tan and threading.", hi: "क्लीन-अप, फ़ेशियल, डी-टैन और थ्रेडिंग।" } },
    nails: { label: { en: "Nails", hi: "नाखून" }, blurb: { en: "Manicures, pedicures, gel and nail art.", hi: "मैनीक्योर, पेडीक्योर, जेल और नेल आर्ट।" } },
    spa: { label: { en: "Spa", hi: "स्पा" }, blurb: { en: "Head, body and foot massage.", hi: "सिर, बदन और पैरों की मालिश।" } },
    grooming: { label: { en: "Men's grooming", hi: "पुरुषों की ग्रूमिंग" }, blurb: { en: "Cuts, beard shaping, shaves and facials.", hi: "कटिंग, दाढ़ी की शेप, शेव और फ़ेशियल।" } },
    bridal: { label: { en: "Bridal", hi: "ब्राइडल" }, blurb: { en: "Bridal, engagement and party make-up.", hi: "दुल्हन, सगाई और पार्टी मेकअप।" } },
    package: { label: { en: "Packages", hi: "पैकेज" }, blurb: { en: "A set of sessions, paid once.", hi: "एक बार भुगतान, कई बार की सेवा।" } },
    membership: { label: { en: "Memberships", hi: "मेंबरशिप" }, blurb: { en: "A year of visits.", hi: "साल भर की सेवा।" } },
  },
  copy: {
    heroLead: { en: "Luxury", hi: "वह शान" },
    heroTurn: { en: "you deserve.", hi: "जिसके आप हक़दार हैं।" },
    heroLine: {
      en: "Hair, skin, nails and bridal, for women and men, at two salons in New Delhi.",
      hi: "महिलाओं और पुरुषों के लिए बाल, त्वचा, नाखून और ब्राइडल, नई दिल्ली के दो सैलून में।",
    },
    book: { en: "Book a visit", hi: "बुकिंग करें" },
    seeServices: { en: "See services", hi: "सेवाएँ देखें" },
    branchesTitle: { en: "Pick your branch", hi: "अपनी शाखा चुनें" },
    bookAt: { en: "Book at {branch}", hi: "{branch} में बुक करें" },
    taking: { en: "Taking requests", hi: "अनुरोध ले रहे हैं" },
    paused: { en: "Not taking requests just now", hi: "अभी अनुरोध नहीं ले रहे" },
    servicesTitle: { en: "Services", hi: "सेवाएँ" },
    servicesLine: { en: "Every service with its time and price, read from the salon's published menu.", hi: "हर सेवा उसके समय और दाम के साथ, सैलून के छपे मेन्यू से।" },
    stylistsTitle: { en: "Our stylists", hi: "हमारे स्टाइलिस्ट" },
    stylistsLine: { en: "Invented names for the sample site; each real stylist appears only with their agreement.", hi: "नमूना साइट के लिए गढ़े नाम; हर असली स्टाइलिस्ट उनकी सहमति से ही दिखेगा।" },
    packagesTitle: { en: "Packages & memberships", hi: "पैकेज और मेंबरशिप" },
    packagesLine: { en: "Pay once and come back through the weeks. Ask at either branch.", hi: "एक बार भुगतान करें और हफ़्तों तक आते रहें। किसी भी शाखा में पूछें।" },
    packageValue: { en: "Holds {amount} of services", hi: "{amount} की सेवाएँ" },
    offersTitle: { en: "Offers", hi: "ऑफ़र" },
    bookTitle: { en: "Book a visit", hi: "बुकिंग करें" },
    bookLine: {
      en: "Pick a branch, a service and a free time from the salon's calendar. The time is held for ten minutes while you add your details.",
      hi: "शाखा, सेवा और सैलून के कैलेंडर से खाली समय चुनें। अपनी जानकारी जोड़ने तक समय दस मिनट रुका रहता है।",
    },
    bookingOff: { en: "Booking on the site is switched off just now. Call the branch.", hi: "साइट पर बुकिंग अभी बंद है। शाखा को फ़ोन करें।" },
    shop: { en: "the salon", hi: "सैलून" },
  },
  whatsapp: null,
};
