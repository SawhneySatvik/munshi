// The word lists cite-or-abstain refuses (answer.ts reads them; add a word here, not a branch there). Entries are
// matched after the same folding as the prose: NFKC, format characters removed, the Devanagari nukta removed,
// chandrabindu read as anusvara, lower case. A false refusal costs an abstention; a missing word can let a number
// through, so when a word is both a number and something else, it is listed unless noted.

/** Numbers written as words, refused anywhere in an answer. */
export const NUMBER_WORDS: Record<"en" | "hi", string[]> = {
  en: [
    // cardinals and scales
    "zero", "nil", "nought", "naught", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
    "thirty", "forty", "fourty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "hundreds", "thousand",
    "thousands", "million", "millions", "billion", "billions", "trillion", "lakh", "lakhs", "lac", "lacs", "crore",
    "crores", "dozen", "dozens", "tens", "pair", "pairs",
    // ordinals
    "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh",
    "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth",
    "twentieth", "thirtieth", "fortieth", "fiftieth", "sixtieth", "seventieth", "eightieth", "ninetieth", "hundredth",
    "thousandth", "millionth",
    // fractions and percent
    "half", "halves", "halve", "halved", "halving", "quarter", "quarters", "thirds", "fourths", "fifths", "tenths",
    "percent", "pct", "cent",
    // multiplicatives
    "once", "twice", "thrice", "single", "double", "doubled", "doubles", "doubling", "triple", "tripled", "triples",
    "tripling", "treble", "trebled", "quadruple", "quadrupled", "twofold", "threefold", "fourfold", "fivefold",
    "tenfold", "hundredfold",
    // romanised Hindi that is not also an English word ("do", "teen", "das" are left out)
    "ek", "paanch", "chaar", "saat", "aath", "bees", "pachaas", "sau", "hazaar", "hazar", "hajar", "karod", "karor",
    "aadha", "aadhi", "adha", "dedh", "dhai", "dugna", "doguna", "tiguna",
  ],
  hi: [
    // cardinals and scales (एक is also the article "a": an answer using it abstains)
    "शून्य", "एक", "दो", "तीन", "चार", "पांच", "छह", "छः", "छे", "सात", "आठ", "नौ", "दस", "ग्यारह", "बारह", "तेरह",
    "चौदह", "पंद्रह", "पन्द्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस", "बीस", "इक्कीस", "बाईस", "तेईस", "चौबीस",
    "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस", "उनतीस", "तीस", "पैंतीस", "चालीस", "पैंतालीस", "पचास", "पचपन",
    "साठ", "पैंसठ", "सत्तर", "पचहत्तर", "अस्सी", "पचासी", "नब्बे", "पंचानबे", "निन्यानवे", "सौ", "सैकड़ा", "सैकड़ों",
    "हज़ार", "हज़ारों", "लाख", "लाखों", "करोड़", "करोड़ों", "अरब", "खरब", "दर्जन", "दर्जनों", "जोड़ा",
    // ordinals (पहले "before" and दूसरे "others" are left out: in prose they are rarely ordinals)
    "पहला", "पहली", "दूसरा", "दूसरी", "तीसरा", "तीसरी", "तीसरे", "चौथा", "चौथी", "चौथे", "पांचवां", "पांचवीं",
    "छठा", "छठी", "सातवां", "आठवां", "दसवां",
    // fractions and percent
    "आधा", "आधी", "आधे", "डेढ़", "ढाई", "सवा", "साढ़े", "पौन", "पौना", "पौने", "चौथाई", "तिहाई", "प्रतिशत",
    "फ़ीसदी",
    // multiplicatives
    "दोगुना", "दोगुनी", "दोगुने", "दुगना", "दुगनी", "दुगने", "दुगुना", "दुगुनी", "तिगुना", "तिगुनी", "चौगुना", "गुना",
    "गुनी", "गुने",
  ],
};

/** Han numerals (Chinese, Japanese, Korean hanja), refused anywhere. 〇 and fullwidth digits are \p{N} already. */
export const CJK_NUMERALS = "零一二三四五六七八九十百千万萬亿億兆两兩壹贰貳叁參肆伍陆陸柒捌玖拾佰仟廿卅";

/** A scale or magnitude beside a handle turns one number into another ("⟦1⟧ lakh"). */
export const SCALE_WORDS = [
  "k", "m", "mn", "bn", "cr", "crs", "lac", "lacs", "lakh", "lakhs", "crore", "crores", "thousand", "thousands",
  "hundred", "hundreds", "million", "millions", "billion", "billions", "hazaar", "hazar", "हज़ार", "लाख", "करोड़",
  "percent", "pct", "प्रतिशत", "फ़ीसदी", "x", "times", "fold", "गुना", "half", "double", "twice", "triple",
];
export const SCALE_SIGNS = "%‰‱×*^";

/**
 * A currency or unit belongs to the cell, which renders its own (a money cell its sign, a quantity cell its unit). A
 * currency word is also refused inside a text cell ("Sharma (owes Rs 50,000)"): a name does not carry an amount.
 */
export const CURRENCY_WORDS = [
  "rs", "inr", "rupee", "rupees", "re", "paise", "paisa", "usd", "aud", "eur", "gbp", "dollar", "dollars",
  "रुपये", "रुपए", "रुपया", "रु", "पैसे",
];
export const UNIT_WORDS = [
  "pack", "packs", "packet", "packets", "pkt", "pkts", "pc", "pcs", "piece", "pieces", "unit", "units", "box",
  "boxes", "kg", "kgs", "kilo", "kilos", "kilogram", "kilograms", "g", "gm", "gms", "gram", "grams", "l", "ltr",
  "litre", "litres", "liter", "liters", "ml", "dozen", "पैकेट", "किलो", "ग्राम", "लीटर", "नग", "पीस", "डिब्बा",
  "डिब्बे", "दर्जन",
];

/**
 * Text columns cited as a name or a label: their digits are part of the name ("Glucose biscuits 70 g", bill GT-1013)
 * and render as its text. A text cell from any other column that holds a digit is refused (it would read as a number).
 */
export const NAME_COLUMNS = ["item", "supplier", "customer", "staff", "category", "bill_no", "latest_bill_no", "reference"];
