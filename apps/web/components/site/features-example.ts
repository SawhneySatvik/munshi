import type { Lang } from "../../lib/types";

// The figures the features page's demonstrations show. All of it is invented, and each block renders inside a
// data-example stage labelled on screen as an example on synthetic data; no row here comes from any database. The two
// model names sit here too, as one of them carries digits and the site's word files carry none.
export const SHELF_MODELS = { names: "Muse Spark", finds: "SAM 3.1" } as const;

export type FeatureSample = {
  brief: [string, string][];
  why: { figure: string; read: string; row: string; decision: string; approver: string };
  shelf: { product: string; books: string; seen: string; gap: string };
  bill: { lines: [string, string, string][]; total: [string, string]; supplier: string };
  ask: { said: string; tr: string | null; answer: (string | { fig: string })[]; said2: string; why: string };
  approve: { title: string; line: string };
  credit: { rows: [string, string, string][]; message: string };
  office: { run: string; steps: [string, string][] };
  site: { shop: string; service: string; times: string[]; picked: string };
  counter: { items: [string, string][]; total: [string, string] };
  offline: [string, string][];
};

const en: FeatureSample = {
  brief: [
    ["Stock short on the shelf", "₹2,640"],
    ["Credit overdue, three customers", "₹2,350"],
    ["UPI settled short", "₹412"],
  ],
  why: {
    figure: "₹2,640",
    read: "Stock against the shelf count · 6:00 am",
    row: "Stock count · line 7",
    decision: "Count approved · Tue 9:14 am",
    approver: "The owner",
  },
  shelf: { product: "Biscuit packet", books: "34", seen: "21", gap: "13" },
  bill: {
    lines: [
      ["Sugar", "50 kg", "₹2,150"],
      ["Mustard oil", "12 L", "₹1,860"],
      ["Tea dust", "8 kg", "₹1,440"],
    ],
    total: ["Total", "₹5,450"],
    supplier: "Sample Traders",
  },
  ask: {
    said: "Aaj kitna udhaar wapas aaya?",
    tr: "How much credit came back today?",
    answer: [{ fig: "₹750" }, " came back today, from Sunita D. Three customers still owe ", { fig: "₹2,350" }, "."],
    said2: "Bank mein kitna hai?",
    why: "the bank statement has not been imported",
  },
  approve: { title: "Reorder · red biscuit packets", line: "13 packets at ₹20 · ₹260" },
  credit: {
    rows: [
      ["Rakesh K.", "41 days", "₹1,200"],
      ["Anil P.", "36 days", "₹750"],
      ["Mohan L.", "31 days", "₹400"],
    ],
    message: "Namaste Rakesh ji, aapka ₹1,200 ka hisaab 41 din se baaki hai.",
  },
  office: {
    run: "Tally · shelf gap · 6:02 am",
    steps: [
      ["stock against the count", "42 ms"],
      ["sam-3.1", "1.8 s"],
      ["every figure has its cell", "6 ms"],
      ["a reorder, waiting for the owner", "11 ms"],
    ],
  },
  site: { shop: "Sample Salon", service: "Haircut · 45 min", times: ["11:00", "11:45", "2:30", "4:15"], picked: "2:30" },
  counter: {
    items: [
      ["Atta 5 kg", "₹245"],
      ["Tea 250 g", "₹130"],
      ["Soap", "₹38"],
    ],
    total: ["Total", "₹413"],
  },
  offline: [
    ["Sales yesterday", "₹18,240"],
    ["Items running low", "6"],
  ],
};

const hi: FeatureSample = {
  brief: [
    ["शेल्फ़ पर स्टॉक कम", "₹2,640"],
    ["बकाया उधार, तीन ग्राहक", "₹2,350"],
    ["UPI कम आया", "₹412"],
  ],
  why: {
    figure: "₹2,640",
    read: "शेल्फ़ की गिनती से स्टॉक · सुबह 6:00",
    row: "स्टॉक गिनती · पंक्ति 7",
    decision: "गिनती मंज़ूर · मंगल सुबह 9:14",
    approver: "मालिक",
  },
  shelf: { product: "बिस्कुट पैकेट", books: "34", seen: "21", gap: "13" },
  bill: {
    lines: [
      ["चीनी", "50 किलो", "₹2,150"],
      ["सरसों का तेल", "12 लीटर", "₹1,860"],
      ["चाय पत्ती", "8 किलो", "₹1,440"],
    ],
    total: ["कुल", "₹5,450"],
    supplier: "नमूना ट्रेडर्स",
  },
  ask: {
    said: "आज कितना उधार वापस आया?",
    tr: null,
    answer: ["आज सुनीता डी. से ", { fig: "₹750" }, " वापस आए। तीन ग्राहकों पर अब भी ", { fig: "₹2,350" }, " बाकी हैं।"],
    said2: "बैंक में कितना है?",
    why: "बैंक स्टेटमेंट अभी नहीं आया",
  },
  approve: { title: "दोबारा ऑर्डर · लाल बिस्कुट पैकेट", line: "13 पैकेट, ₹20 के हिसाब से · ₹260" },
  credit: {
    rows: [
      ["राकेश के.", "41 दिन", "₹1,200"],
      ["अनिल पी.", "36 दिन", "₹750"],
      ["मोहन एल.", "31 दिन", "₹400"],
    ],
    message: "नमस्ते राकेश जी, आपका ₹1,200 का हिसाब 41 दिन से बाकी है।",
  },
  office: {
    run: "Tally · शेल्फ़ की कमी · सुबह 6:02",
    steps: [
      ["गिनती के मुक़ाबले स्टॉक", "42 ms"],
      ["sam-3.1", "1.8 s"],
      ["हर आँकड़े का अपना खाना है", "6 ms"],
      ["दोबारा ऑर्डर, मालिक के इंतज़ार में", "11 ms"],
    ],
  },
  site: { shop: "नमूना सैलून", service: "हेयरकट · 45 मिनट", times: ["11:00", "11:45", "2:30", "4:15"], picked: "2:30" },
  counter: {
    items: [
      ["आटा 5 किलो", "₹245"],
      ["चाय 250 ग्राम", "₹130"],
      ["साबुन", "₹38"],
    ],
    total: ["कुल", "₹413"],
  },
  offline: [
    ["कल की बिक्री", "₹18,240"],
    ["कम पड़ता सामान", "6"],
  ],
};

export const FEATURE_SAMPLE: Record<Lang, FeatureSample> = { en, hi };
