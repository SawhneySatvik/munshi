// Independent tables for the number-word tests (answer.test.ts): words.ts is checked against these, never against itself.
//
// CLDR_HI: Unicode CLDR's Hindi spell-out rules (RBNF, locale hi) for 1–100, as the ICU in macOS 26.5.2 renders them
// through Foundation's NumberFormatter (style spellOut, locale hi_IN), generated on 27 Oct 2026 with
//   osascript -l JavaScript -e "ObjC.import('Foundation'); const f = $.NSNumberFormatter.alloc.init; f.numberStyle = 5;
//     f.locale = $.NSLocale.alloc.initWithLocaleIdentifier('hi_IN');
//     [...Array(100).keys()].map((i) => ObjC.unwrap(f.stringFromNumber($(i + 1)))).join(' ')"
// and CLDR_HI_SCALES the same for 0, 1000, 100000 and 10000000. The strings are as Foundation returned them.
export const CLDR_HI: string[] = [
  "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ", "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पन्द्रह",
  "सोलह", "सत्रह", "अठारह", "उन्नीस", "बीस", "इक्कीस", "बाईस", "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस",
  "अट्ठाईस", "उनतीस", "तीस", "इकतीस", "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस", "अड़तीस", "उनतालीस",
  "चालीस", "इकतालीस", "बयालीस", "तैंतालीस", "चौवालीस", "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास", "पचास",
  "इक्यावन", "बावन", "तिरेपन", "चौवन", "पचपन", "छप्पन", "सत्तावन", "अट्ठावन", "उनसठ", "साठ", "इकसठ", "बासठ", "तिरेसठ",
  "चौंसठ", "पैंसठ", "छियासठ", "सड़सठ", "अड़सठ", "उनहत्तर", "सत्तर", "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर",
  "पचहत्तर", "छिहत्तर", "सतहत्तर", "अठहत्तर", "उनासी", "अस्सी", "इक्यासी", "बयासी", "तिरासी", "चौरासी", "पचासी",
  "छियासी", "सत्तासी", "अट्ठासी", "नवासी", "नब्बे", "इक्यानबे", "बानबे", "तिरानबे", "चौरानबे", "पंचानबे", "छियानबे",
  "सत्तानबे", "अट्ठानबे", "निन्यानबे", "एक सौ",
];
export const CLDR_HI_SCALES: string[] = ["शून्य", "एक हज़ार", "एक लाख", "एक करोड़"];

// An independent hand-made list of the Hindi numbers 1–100 and their romanised words, from the second adversarial
// probe, verbatim.
export const REVIEW_HI: string[] = [
  "एक", "दो", "तीन", "चार", "पांच", "छह", "सात", "आठ", "नौ", "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह",
  "सत्रह", "अठारह", "उन्नीस", "बीस", "इक्कीस", "बाईस", "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस",
  "उनतीस", "तीस", "इकतीस", "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस", "अड़तीस", "उनतालीस", "चालीस",
  "इकतालीस", "बयालीस", "तैंतालीस", "चवालीस", "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास", "पचास",
  "इक्यावन", "बावन", "तिरपन", "चौवन", "पचपन", "छप्पन", "सत्तावन", "अट्ठावन", "उनसठ", "साठ", "इकसठ", "बासठ", "तिरसठ",
  "चौंसठ", "पैंसठ", "छियासठ", "सड़सठ", "अड़सठ", "उनहत्तर", "सत्तर", "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर",
  "पचहत्तर", "छिहत्तर", "सतहत्तर", "अठहत्तर", "उन्यासी", "अस्सी", "इक्यासी", "बयासी", "तिरासी", "चौरासी", "पचासी",
  "छियासी", "सत्तासी", "अट्ठासी", "नवासी", "नब्बे", "इक्यानवे", "बानवे", "तिरानवे", "चौरानवे", "पचानवे", "छियानवे",
  "सत्तानवे", "अट्ठानवे", "निन्यानवे", "सौ",
];
export const REVIEW_HI_LATN: string[] = [
  "ek", "do", "teen", "chaar", "char", "paanch", "panch", "chhah", "chhe", "saat", "aath", "nau", "das", "gyarah",
  "barah", "terah", "chaudah", "pandrah", "solah", "satrah", "atharah", "unnis", "bees", "ikkis", "baais", "teis",
  "chaubis", "pachchis", "tees", "chalis", "pachas", "pachaas", "saath", "sattar", "assi", "nabbe", "sau", "hazaar",
];
