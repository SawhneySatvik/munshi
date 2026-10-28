// ILLUSTRATIVE FIXTURE, shaped like the developer kit's responses (lib/types.ts). Every piece, colour, size and price
// below is a sample written for the design, not the shop's stock. The site labels them "Sample prices" until the shop's API feeds it
// reads the shop's published release instead.
import type { Data } from "../../lib/business.ts";
import { rupees } from "../../lib/sample.ts";
import type { Variant } from "../../lib/types.ts";

const SIZES = ["S", "M", "L", "XL", "XXL"];

/** Every colour in every size (or one free-size row), at one price unless `xxl` adds to the largest size. */
function variants(id: string, colours: [string, string][], price: number, sizes?: string[], xxl = 0): Variant[] {
  return colours.flatMap(([colour, swatch]) =>
    (sizes ?? [undefined]).map((size) => ({
      id: `${id}-${colour.toLowerCase().replace(/\W+/g, "-")}${size ? `-${size.toLowerCase()}` : ""}`,
      attrs: size ? { colour, swatch, size } : { colour, swatch },
      price: rupees(price + (size === "XXL" ? xxl : 0)),
    })),
  );
}

export const data: Data = {
  site: {
    name: "Suit shop (name pending)",
    businessType: "apparel",
    privacyNoticeUrl: "/privacy",
    privacyVersion: "draft-1",
    consentText: "Send me updates and offers from the shop on WhatsApp",
    consentVersion: "draft-1",
    intake: "open",
    releaseId: "sample",
    publishedAt: "2026-10-28T00:00:00+05:30",
    sample: true,
    shops: [{ id: "delhi", name: "Suit shop", area: "Delhi", hi: { name: "सूट शॉप", area: "दिल्ली" } }],
  },
  services: [],
  packages: [],
  offers: [
    {
      id: "o-dhanteras",
      title: "Dhanteras gift box",
      detail: "Any festive suit bought for Dhanteras goes home in a gift box.",
      until: "Till Dhanteras",
      appliesTo: ["stitched", "semi"],
      hi: { title: "धनतेरस गिफ़्ट बॉक्स", detail: "धनतेरस पर लिया हर त्योहारी सूट गिफ़्ट बॉक्स में घर जाएगा।", until: "धनतेरस तक" },
    },
    {
      id: "o-diwali",
      title: "The Diwali edit",
      detail: "New silk-blend and georgette suits in this season's colours.",
      until: "Till Diwali",
      appliesTo: ["unstitched"],
      hi: { title: "दिवाली कलेक्शन", detail: "इस मौसम के रंगों में नए सिल्क-ब्लेंड और जॉर्जेट सूट।", until: "दिवाली तक" },
    },
    {
      id: "o-fall",
      title: "Fall and pico, free",
      detail: "Free fall and pico on any dupatta bought this festive season.",
      until: "Till Diwali",
      appliesTo: ["dupattas"],
      hi: { title: "फ़ॉल और पीको मुफ़्त", detail: "इस त्योहार के मौसम में लिए हर दुपट्टे पर फ़ॉल और पीको मुफ़्त।", until: "दिवाली तक" },
    },
  ],
  catalogue: [
    {
      id: "u-gota",
      category: "unstitched",
      name: "Silk-cotton suit set with gota work",
      description: "A kameez length with gota-patti at the neck and hem, a plain salwar length and a matching dupatta.",
      fabric: "Silk-cotton, with a chiffon dupatta",
      variants: variants("u-gota", [["Rani pink", "#b0245f"], ["Mint", "#8fc9b0"], ["Mustard", "#d9a530"]], 2450),
      hi: { name: "गोटा वर्क वाला सिल्क-कॉटन सूट सेट", description: "गले और घेर पर गोटा-पत्ती वाला कमीज़ का कपड़ा, सादा सलवार का कपड़ा और मैचिंग दुपट्टा।", fabric: "सिल्क-कॉटन, शिफ़ॉन दुपट्टे के साथ" },
    },
    {
      id: "u-print",
      category: "unstitched",
      name: "Printed cotton suit set",
      description: "Soft block-style prints for every day, with a light mulmul dupatta.",
      fabric: "Cotton, with a mulmul dupatta",
      variants: variants("u-print", [["Indigo", "#2f4b8a"], ["Rust", "#b5532d"], ["Leaf green", "#4f8a4a"], ["Peach", "#f0a487"], ["Ivory", "#efe6d2"]], 1150),
      hi: { name: "प्रिंटेड कॉटन सूट सेट", description: "रोज़ पहनने के लिए नरम ब्लॉक-जैसे प्रिंट, हल्के मलमल दुपट्टे के साथ।", fabric: "कॉटन, मलमल दुपट्टे के साथ" },
    },
    {
      id: "u-muslin",
      category: "unstitched",
      name: "Embroidered muslin suit set",
      description: "Thread embroidery on the yoke and sleeves, with a sheer organza dupatta.",
      fabric: "Muslin, with an organza dupatta",
      variants: variants("u-muslin", [["Wine", "#7a1e3a"], ["Bottle green", "#1f5a43"], ["Powder blue", "#9cc0de"]], 2950),
      hi: { name: "कढ़ाई वाला मलमल सूट सेट", description: "योक और आस्तीन पर धागे की कढ़ाई, पारदर्शी ऑर्गेंज़ा दुपट्टे के साथ।", fabric: "मलमल, ऑर्गेंज़ा दुपट्टे के साथ" },
    },
    {
      id: "ss-anarkali",
      category: "semi",
      name: "Georgette Anarkali, semi-stitched",
      description: "A flared Anarkali, made except the side seams, so your tailor fits it to you.",
      fabric: "Georgette, with a net dupatta",
      variants: variants("ss-anarkali", [["Maroon", "#7c1d2e"], ["Royal blue", "#2a4aa0"], ["Emerald", "#1f7a5a"]], 3999, ["Free size"]),
      hi: { name: "जॉर्जेट अनारकली, सेमी-स्टिच्ड", description: "घेरदार अनारकली, साइड की सिलाई छोड़कर तैयार, ताकि दर्ज़ी आपके नाप से फ़िट करे।", fabric: "जॉर्जेट, नेट दुपट्टे के साथ" },
    },
    {
      id: "ss-straight",
      category: "semi",
      name: "Rayon straight suit, semi-stitched",
      description: "A straight kurta with the sides left open for fitting, and a chiffon dupatta.",
      fabric: "Rayon, with a chiffon dupatta",
      variants: variants("ss-straight", [["Lemon", "#e9d44d"], ["Lavender", "#b3a0d6"]], 2299, ["Free size"]),
      hi: { name: "रेयॉन स्ट्रेट सूट, सेमी-स्टिच्ड", description: "सीधा कुर्ता, फ़िटिंग के लिए साइड खुली, शिफ़ॉन दुपट्टे के साथ।", fabric: "रेयॉन, शिफ़ॉन दुपट्टे के साथ" },
    },
    {
      id: "st-palazzo",
      category: "stitched",
      name: "Cotton kurta with palazzo",
      description: "A ready-to-wear kurta and palazzo set, light enough for warm afternoons.",
      fabric: "Cambric cotton",
      variants: variants("st-palazzo", [["Yellow", "#f2c14e"], ["White", "#f5f1e6"], ["Teal", "#2b8a8a"]], 1799, SIZES),
      hi: { name: "कॉटन कुर्ता और पलाज़ो", description: "पहनने को तैयार कुर्ता-पलाज़ो सेट, गरम दोपहर के लिए हल्का।", fabric: "कैम्ब्रिक कॉटन" },
    },
    {
      id: "st-festive",
      category: "stitched",
      name: "Silk-blend festive suit",
      description: "Kurta, salwar and a brocade-border dupatta, stitched and ready for the evening.",
      fabric: "Silk blend, with a brocade-border dupatta",
      variants: variants("st-festive", [["Magenta", "#b3196a"], ["Bottle green", "#1f5a43"], ["Antique gold", "#c9a03d"]], 4499, SIZES, 200),
      hi: { name: "सिल्क-ब्लेंड त्योहारी सूट", description: "कुर्ता, सलवार और ब्रोकेड बॉर्डर वाला दुपट्टा, सिला हुआ और शाम के लिए तैयार।", fabric: "सिल्क ब्लेंड, ब्रोकेड बॉर्डर दुपट्टे के साथ" },
    },
    {
      id: "st-thread",
      category: "stitched",
      name: "Thread-work straight suit",
      description: "Fine white thread embroidery on a straight kurta, with trousers and a dupatta.",
      fabric: "Georgette with thread work",
      variants: variants("st-thread", [["White", "#f5f1e6"], ["Blush pink", "#f2b6c6"], ["Sky", "#a9cfe8"]], 3299, SIZES),
      hi: { name: "धागे के काम वाला स्ट्रेट सूट", description: "सीधे कुर्ते पर बारीक सफ़ेद धागे की कढ़ाई, ट्राउज़र और दुपट्टे के साथ।", fabric: "धागे के काम वाला जॉर्जेट" },
    },
    {
      id: "d-brocade",
      category: "dupattas",
      name: "Brocade silk dupatta",
      description: "A woven zari border and scattered motifs, for a plain suit that needs a lift.",
      fabric: "Art silk with a zari border",
      variants: variants("d-brocade", [["Red", "#b3202d"], ["Purple", "#5b2a7a"], ["Green", "#2f7a45"]], 1899),
      hi: { name: "ब्रोकेड सिल्क दुपट्टा", description: "बुना हुआ ज़री बॉर्डर और बिखरे बूटे, सादे सूट को निखारने के लिए।", fabric: "आर्ट सिल्क, ज़री बॉर्डर" },
    },
    {
      id: "d-embroidered",
      category: "dupattas",
      name: "Embroidered cotton dupatta",
      description: "Bright thread embroidery across the whole length.",
      fabric: "Cotton with thread embroidery",
      variants: variants("d-embroidered", [["Orange", "#e2702c"], ["Pink", "#d1336d"]], 1499),
      hi: { name: "कढ़ाई वाला कॉटन दुपट्टा", description: "पूरी लंबाई में चटक धागे की कढ़ाई।", fabric: "कॉटन, धागे की कढ़ाई" },
    },
    {
      id: "d-tiedye",
      category: "dupattas",
      name: "Tie-dye georgette dupatta",
      description: "Tiny tie-dye dots in festive colours, light and easy to drape.",
      fabric: "Georgette, tie-dyed",
      variants: variants("d-tiedye", [["Red", "#b3202d"], ["Yellow", "#f2c14e"], ["Green", "#2f7a45"], ["Blue", "#2f4b8a"], ["Pink", "#d1336d"]], 999),
      hi: { name: "टाई-डाई जॉर्जेट दुपट्टा", description: "त्योहारी रंगों में छोटी टाई-डाई बिंदियाँ, हल्का और ओढ़ने में आसान।", fabric: "जॉर्जेट, टाई-डाई" },
    },
  ],
};
