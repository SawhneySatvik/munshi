// The suit shop's site copy, written for this site. The shop's name, address, hours and WhatsApp number have not
// arrived: the name shows as pending, and nothing here invents the others.
import type { Profile } from "../../lib/business.ts";
import { whatsappLink } from "../../lib/whatsapp.ts";

const ASK_EN = "Hello! I saw your suits on your website and would like to ask about a piece.";
const ASK_HI = "नमस्ते! मैंने आपकी वेबसाइट पर सूट देखे, एक पीस के बारे में पूछना है।";
const ask = { en: whatsappLink(null, ASK_EN), hi: whatsappLink(null, ASK_HI) };

export const profile: Profile = {
  slug: "suit-shop",
  kind: "apparel",
  fullName: "Suit shop (name pending)",
  name: {
    en: { lead: "Suit", accent: "shop", short: "shop" },
    hi: { lead: "सूट", accent: "शॉप", short: "शॉप" },
  },
  pending: { en: "name pending", hi: "नाम जल्द आएगा" },
  pill: { en: "Delhi · ladies' suits · festive edit", hi: "दिल्ली · महिलाओं के सूट · त्योहार कलेक्शन" },
  sub: {
    en: "Unstitched, semi-stitched and stitched suits, with dupattas to match.",
    hi: "अनसिले, सेमी-स्टिच्ड और सिले हुए सूट, साथ में मैचिंग दुपट्टे।",
  },
  cta: {
    primary: { label: { en: "Browse suits", hi: "सूट देखें" }, href: "/catalogue" },
    secondary: { label: { en: "WhatsApp us", hi: "WhatsApp करें" }, href: ask },
  },
  headerCta: { label: { en: "Ask on WhatsApp", hi: "WhatsApp पर पूछें" }, href: ask },
  nav: [
    { label: { en: "Catalogue", hi: "कैटलॉग" }, href: "/catalogue" },
    { label: { en: "Our story", hi: "हमारी कहानी" }, href: "/story" },
  ],
  categories: [
    { id: "unstitched", label: { en: "Unstitched", hi: "अनसिले" }, blurb: { en: "Fabric sets for your own tailor.", hi: "अपने दर्ज़ी के लिए कपड़े के सेट।" } },
    { id: "semi", label: { en: "Semi-stitched", hi: "सेमी-स्टिच्ड" }, blurb: { en: "Nearly made, fitted to you.", hi: "लगभग तैयार, आपके नाप से फ़िट।" } },
    { id: "stitched", label: { en: "Stitched", hi: "सिले हुए" }, blurb: { en: "Ready to wear, in your size.", hi: "पहनने को तैयार, आपके साइज़ में।" } },
    { id: "dupattas", label: { en: "Dupattas", hi: "दुपट्टे" }, blurb: { en: "Plain, woven and embroidered.", hi: "सादे, बुने हुए और कढ़ाई वाले।" } },
  ],
  marquee: [
    { en: "Unstitched", hi: "अनसिले" },
    { en: "Semi-stitched", hi: "सेमी-स्टिच्ड" },
    { en: "Stitched", hi: "सिले हुए" },
    { en: "Dupattas", hi: "दुपट्टे" },
    { en: "Dhanteras & Diwali", hi: "धनतेरस और दिवाली" },
    { en: "Ask on WhatsApp", hi: "WhatsApp पर पूछें" },
  ],
  copy: {
    shop: { en: "the shop", hi: "दुकान" },
    askLink: ask,
    askText: { en: ASK_EN, hi: ASK_HI },
    footerLine: {
      en: "Ladies' suits and dupattas in Delhi. The shop's name, address and number arrive soon.",
      hi: "दिल्ली में महिलाओं के सूट और दुपट्टे। दुकान का नाम, पता और नंबर जल्द आएँगे।",
    },
    kindsTitle: { en: "Shop by kind", hi: "किस्म से चुनें" },
    kindMeta: { en: "From {price}", hi: "{price} से" },
    offersTitle: { en: "Dhanteras & Diwali", hi: "धनतेरस और दिवाली" },
    newTitle: { en: "New for the festive season", hi: "त्योहार के लिए नया" },
    newLine: { en: "A few pieces from the catalogue. Every colour is on the piece's own page.", hi: "कैटलॉग से कुछ पीस। हर रंग पीस के अपने पेज पर है।" },
    visitTitle: { en: "Come and see the colours", hi: "आकर रंग देखिए" },
    visitBody: {
      en: "The shop's address arrives with its details. Until then, WhatsApp is the quickest way to ask.",
      hi: "दुकान का पता उसकी जानकारी के साथ आएगा। तब तक पूछने का सबसे जल्दी तरीका WhatsApp है।",
    },
    catalogueTitle: { en: "Catalogue", hi: "कैटलॉग" },
    catalogueLine: {
      en: "Suits and dupattas by kind. Open a piece for its colours, sizes and fabric.",
      hi: "किस्म के हिसाब से सूट और दुपट्टे। रंग, साइज़ और कपड़ा देखने के लिए पीस खोलें।",
    },
    allKinds: { en: "All", hi: "सभी" },
    prefill: {
      en: "Hello! I'd like to ask about the {product} in {colour}{size}.",
      hi: "नमस्ते! मुझे {product} के बारे में पूछना है, रंग {colour}{size}।",
    },
    prefillSize: { en: ", size {size}", hi: ", साइज़ {size}" },
    askNote: {
      en: "WhatsApp opens with your message ready. The shop's own number is on its way; until it arrives, choose whom to send it to.",
      hi: "WhatsApp आपका संदेश तैयार करके खुलेगा। दुकान का नंबर जल्द आएगा; तब तक भेजने वाला खुद चुनें।",
    },
    sizeNote_unstitched: { en: "Unstitched: your tailor cuts it to your size.", hi: "अनसिला: आपका दर्ज़ी आपके नाप से काटेगा।" },
    sizeNote_dupattas: { en: "One length, to drape any way you like.", hi: "एक लंबाई, जैसे चाहें वैसे ओढ़ें।" },
    moreTitle: { en: "More like this", hi: "ऐसे और भी" },
    backToCatalogue: { en: "Back to the catalogue", hi: "कैटलॉग पर लौटें" },
  },
  story: {
    pill: { en: "Our story", hi: "हमारी कहानी" },
    title: {
      en: { lead: "Suits for every", accent: "festive day" },
      hi: { lead: "हर त्योहार के लिए", accent: "एक सूट" },
    },
    body: [
      {
        en: "This is a ladies' suit shop in Delhi. It sells unstitched sets for your own tailor, semi-stitched suits that need only a fitting, ready stitched suits, and dupattas to finish them.",
        hi: "यह दिल्ली में महिलाओं के सूट की दुकान है। यहाँ अपने दर्ज़ी के लिए अनसिले सेट, सिर्फ़ फ़िटिंग वाले सेमी-स्टिच्ड सूट, तैयार सिले सूट और उनके साथ के दुपट्टे मिलते हैं।",
      },
      {
        en: "The shop's own story, in the owners' words, comes here once they send it, along with the name over the door.",
        hi: "दुकान की अपनी कहानी, मालिकों के शब्दों में, और दरवाज़े के ऊपर लिखा नाम, आते ही यहाँ होंगे।",
      },
    ],
    promises: [
      {
        icon: "chat",
        title: { en: "Ask before you come", hi: "आने से पहले पूछ लें" },
        body: { en: "Ask about any piece on WhatsApp, with its colour and size already in the message.", hi: "किसी भी पीस के बारे में WhatsApp पर पूछें, रंग और साइज़ संदेश में पहले से लिखा होगा।" },
      },
      {
        icon: "tag",
        title: { en: "Prices you can see", hi: "दाम साफ़ दिखते हैं" },
        body: { en: "Every piece shows its price and colours before you ask.", hi: "पूछने से पहले हर पीस का दाम और रंग दिखते हैं।" },
      },
      {
        icon: "dupattas",
        title: { en: "Every kind in one place", hi: "हर किस्म एक जगह" },
        body: { en: "Unstitched, semi-stitched and stitched suits sit beside the dupattas that go with them.", hi: "अनसिले, सेमी-स्टिच्ड और सिले सूट, उनके साथ के दुपट्टों के बगल में।" },
      },
    ],
    close: {
      icon: "shop",
      title: { en: "Visit the shop", hi: "दुकान पर आइए" },
      body: { en: "The address arrives with the shop's details. Until then, ask anything on WhatsApp.", hi: "पता दुकान की जानकारी के साथ आएगा। तब तक WhatsApp पर कुछ भी पूछें।" },
      cta: { label: { en: "Ask on WhatsApp", hi: "WhatsApp पर पूछें" }, href: ask },
    },
  },
  featured: ["st-festive", "u-gota", "d-brocade"],
  whatsapp: null,
};
