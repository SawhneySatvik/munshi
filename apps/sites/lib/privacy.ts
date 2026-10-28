import type { Text } from "./business.ts";

// The draft privacy notice both sites link beside every send button (docs/MERCHANTS-DESIGN.md §7.1). The shop and the
// founder review the wording before a live site takes real requests; this is not legal advice.
type Section = { title: Text; body: Text; kinds?: ("salon" | "apparel")[] };

export const privacy: { title: Text; lead: Text; sections: Section[]; foot: Text } = {
  title: { en: "Privacy notice", hi: "निजता सूचना" },
  lead: {
    en: "Draft, version {v}. The shop reviews this wording before the site takes real requests.",
    hi: "मसौदा, संस्करण {v}। असली अनुरोध लेने से पहले दुकान यह भाषा जाँचेगी।",
  },
  sections: [
    {
      title: { en: "Who holds what you send", hi: "आपका भेजा किसके पास रहता है" },
      body: {
        en: "{shop} holds it. Munshi is the software that keeps it for the shop and does the work on the shop's behalf.",
        hi: "{shop} के पास। Munshi वह सॉफ़्टवेयर है जो इसे दुकान के लिए रखता है और दुकान की ओर से काम करता है।",
      },
    },
    {
      kinds: ["salon"],
      title: { en: "What is collected, and why", hi: "क्या लिया जाता है, और क्यों" },
      body: {
        en: "Your name, your mobile number, the branch, day and time of day you choose, the services and any note. They are used to answer your request and for nothing else.",
        hi: "आपका नाम, मोबाइल नंबर, आपकी चुनी शाखा, दिन और समय, सेवाएँ और कोई नोट। इनका इस्तेमाल सिर्फ़ आपके अनुरोध का जवाब देने के लिए होता है।",
      },
    },
    {
      kinds: ["apparel"],
      title: { en: "What is collected, and why", hi: "क्या लिया जाता है, और क्यों" },
      body: {
        en: "This site has no form. When you tap Ask on WhatsApp, your message goes from your own WhatsApp, and the shop sees it there to answer you.",
        hi: "इस साइट पर कोई फ़ॉर्म नहीं है। “WhatsApp पर पूछें” दबाने पर संदेश आपके अपने WhatsApp से जाता है, और दुकान जवाब देने के लिए उसे वहीं देखती है।",
      },
    },
    {
      title: { en: "WhatsApp updates", hi: "WhatsApp अपडेट" },
      body: {
        en: "Offers come only if you tick the box, and only after you reply YES to the shop's first message. Reply STOP at any time to end them.",
        hi: "ऑफ़र तभी आते हैं जब आप बॉक्स पर टिक करें, और दुकान के पहले संदेश का जवाब YES में दें। बंद करने के लिए कभी भी STOP लिखें।",
      },
    },
    {
      title: { en: "How long it is kept", hi: "कब तक रखा जाता है" },
      body: {
        en: "A request is cleared 90 days after it closes. Ask the shop to erase yours sooner and it will erase it in Munshi.",
        hi: "अनुरोध बंद होने के 90 दिन बाद मिटा दिया जाता है। पहले मिटवाना हो तो दुकान से कहें, वह Munshi में मिटा देगी।",
      },
    },
    {
      title: { en: "AI", hi: "AI" },
      body: {
        en: "The shop uses AI models to answer questions about its own books and to draft replies. A message written with AI says so.",
        hi: "दुकान अपने खातों से जुड़े सवालों और जवाबों के मसौदे के लिए AI मॉडल इस्तेमाल करती है। AI से लिखा संदेश यह बताता है।",
      },
    },
    {
      title: { en: "Payments", hi: "भुगतान" },
      body: { en: "No payment is taken on this site.", hi: "इस साइट पर कोई भुगतान नहीं लिया जाता।" },
    },
  ],
  foot: {
    en: "This draft is not legal advice. The shop's own notice replaces it.",
    hi: "यह मसौदा कानूनी सलाह नहीं है। दुकान की अपनी सूचना इसकी जगह लेगी।",
  },
};
