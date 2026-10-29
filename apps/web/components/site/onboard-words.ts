import type { Lang } from "../../lib/types";

// The onboarding screens' own words (the fields' labels and the refusals are the sign-in screens', app/(auth)/words.ts).
// No digits.
const en = {
  kicker: "Sign up",
  title: "Open a sample shop of your own.",
  lede: "Three short steps. On this demo, signing up makes a private sample shop on synthetic data: no email, no password.",
  progress: "Steps",
  stepType: "Your shop",
  stepName: "Its name",
  stepIn: "You're in",
  typeTitle: "What kind of shop is it?",
  kiranaBody: "Groceries and daily needs: the counter, the shelf, the suppliers and the credit book.",
  salonBody: "Services and appointments, packages, colour and products used.",
  apparelBody: "A clothing boutique: orders, alterations, stock by size and colour.",
  nameTitle: "Name it.",
  slugNote: "Lower-case letters, digits and hyphens, starting with a letter. A sample shop's public site stays hidden.",
  inTitle: "You're in, once you open it.",
  next: "Next",
  back: "Back",
  liveTitle: "Shops join Munshi by invitation.",
  liveBody: "For now a real shop is set up with its owner, who then gets a one-time invite to set a password. Already invited? Log in.",
  haveShop: "Already have a shop on Munshi?",
  pickInstead: "Or try a sample shop that is already set up.",
} as const;

export type OnboardWords = Record<keyof typeof en, string>;

const hi: OnboardWords = {
  kicker: "साइन अप",
  title: "अपनी एक नमूना दुकान खोलें।",
  lede: "तीन छोटे क़दम। इस डेमो पर साइन अप करने से सिंथेटिक डेटा पर एक निजी नमूना दुकान बनती है: न ईमेल, न पासवर्ड।",
  progress: "क़दम",
  stepType: "आपकी दुकान",
  stepName: "उसका नाम",
  stepIn: "आप अंदर",
  typeTitle: "दुकान किस तरह की है?",
  kiranaBody: "राशन और रोज़ की चीज़ें: काउंटर, शेल्फ़, सप्लायर और उधार बही।",
  salonBody: "सेवाएँ और बुकिंग, पैकेज, लगा रंग और सामान।",
  apparelBody: "कपड़ों की दुकान: ऑर्डर, ऑल्टरेशन, साइज़ और रंग के हिसाब से स्टॉक।",
  nameTitle: "नाम रखें।",
  slugNote: "छोटे अक्षर, अंक और हाइफ़न, शुरुआत अक्षर से। नमूना दुकान की सार्वजनिक साइट छिपी रहती है।",
  inTitle: "खोलते ही आप अंदर।",
  next: "आगे",
  back: "पीछे",
  liveTitle: "दुकानें मुंशी से निमंत्रण पर जुड़ती हैं।",
  liveBody: "अभी असली दुकान उसके मालिक के साथ मिलकर बनाई जाती है, फिर मालिक को पासवर्ड रखने का एक बार का निमंत्रण मिलता है। निमंत्रण मिल चुका है? लॉग इन करें।",
  haveShop: "मुंशी पर पहले से दुकान है?",
  pickInstead: "या पहले से तैयार कोई नमूना दुकान आज़माएँ।",
};

export const ONBOARD_WORDS: Record<Lang, OnboardWords> = { en, hi };
