import type { Lang } from "../../lib/types";

// The site's one worked example: a sample shop's owner asks at closing time, Munshi answers with figures that open
// their records, and a reminder waits for a yes. Everything here is invented and is shown under the label "Example ·
// a sample shop" with the note that it is synthetic; it is the only place on the site that carries digits. No row here
// comes from any database, and nothing on the site reads or writes one.

export type RecordId = "paid" | "owing";

export type ExampleRecord = { title: string; rows: [string, string, string][]; total?: [string, string, string]; note: string };

export type Example = {
  question: string;
  translation: string;
  /** The answer as text runs and figures; a figure names the record it opens. */
  answer: Array<string | { fig: string; opens: RecordId }>;
  message: string;
  records: Record<RecordId, ExampleRecord>;
};

const records = (lang: Lang): Record<RecordId, ExampleRecord> =>
  lang === "hi"
    ? {
        paid: {
          title: "रोज़नामचा · पंक्ति 4 · दोपहर 1:05",
          rows: [
            ["सुनीता डी.", "नकद", "₹750"],
            ["उधार कब से", "26 सितंबर", "33 दिन"],
          ],
          note: "काउंटर पर मालिक ने दर्ज किया · नमूना डेटा",
        },
        owing: {
          title: "उधार बही · 30 दिन से ज़्यादा",
          rows: [
            ["राकेश के.", "41 दिन", "₹1,200"],
            ["अनिल पी.", "36 दिन", "₹750"],
            ["मोहन एल.", "31 दिन", "₹400"],
          ],
          total: ["कुल", "3 ग्राहक", "₹2,350"],
          note: "रात 10:12 पर पढ़ा · 3 पंक्तियाँ · कुछ नहीं बदला · नमूना डेटा",
        },
      }
    : {
        paid: {
          title: "Day book · line 4 · 1:05 pm",
          rows: [
            ["Sunita D.", "cash", "₹750"],
            ["Owed since", "26 Sep", "33 days"],
          ],
          note: "Entered by the owner at the counter · sample data",
        },
        owing: {
          title: "Credit book · over 30 days",
          rows: [
            ["Rakesh K.", "41 days", "₹1,200"],
            ["Anil P.", "36 days", "₹750"],
            ["Mohan L.", "31 days", "₹400"],
          ],
          total: ["Total", "3 customers", "₹2,350"],
          note: "Read at 10:12 pm · 3 rows · nothing was changed · sample data",
        },
      };

export function exampleIn(lang: Lang): Example {
  const question = "आज कितना उधार वापस आया?";
  const message = "नमस्ते राकेश जी, आपका ₹1,200 का हिसाब 41 दिन से बाकी है। सुविधा हो तो इस हफ़्ते चुका दीजिए। — नमूना किराना स्टोर";
  if (lang === "hi") {
    return {
      question,
      translation: "How much credit came back today?",
      answer: [
        "आज सुनीता डी. से ",
        { fig: "₹750", opens: "paid" },
        " वापस आए। ",
        { fig: "तीन ग्राहकों", opens: "owing" },
        " पर अब भी ",
        { fig: "₹2,350", opens: "owing" },
        " तीस दिन से ज़्यादा से बाकी हैं।",
      ],
      message,
      records: records(lang),
    };
  }
  return {
    question,
    translation: "How much credit came back today?",
    answer: [
      { fig: "₹750", opens: "paid" },
      " came back today, from Sunita D. ",
      { fig: "Three customers", opens: "owing" },
      " still owe ",
      { fig: "₹2,350", opens: "owing" },
      " for more than thirty days.",
    ],
    message,
    records: records(lang),
  };
}
