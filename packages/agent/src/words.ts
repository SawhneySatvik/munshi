// The word lists cite-or-abstain refuses (answer.ts reads them; add a word here, not a branch there). Entries are
// matched after the same folding as the prose: NFKC, format characters removed, accents on Latin letters removed, the
// Devanagari nukta removed, chandrabindu read as anusvara, lower case. A false refusal costs an abstention; a missing
// word can let a number through, so when a word is both a number and something else, it is listed unless noted.

/**
 * Hindi cardinals 0–100 in the spellings in use (several for many numbers), and the scales. Each is also refused with
 * an ordinal or plural ending (HINDI_ENDINGS). एक is also the article "a" and दो the verb "give": an answer using
 * either abstains.
 */
export const HINDI_CARDINALS = [
  "शून्य", "एक", "दो", "तीन", "चार", "पांच", "छह", "छः", "छे", "छ", "सात", "आठ", "नौ", "दस", "ग्यारह", "बारह",
  "तेरह", "चौदह", "पंद्रह", "पन्द्रह", "सोलह", "सत्रह", "अठारह", "अट्ठारह", "उन्नीस", "बीस", "इक्कीस", "बाईस",
  "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "सताईस", "अट्ठाईस", "अठाईस", "उनतीस", "उन्तीस", "तीस", "इकतीस",
  "इकत्तीस", "बत्तीस", "तैंतीस", "तेंतीस", "तेतीस", "चौंतीस", "चौतीस", "पैंतीस", "पेंतीस", "छत्तीस", "सैंतीस",
  "सेंतीस", "अड़तीस", "उनतालीस", "उन्तालीस", "चालीस", "इकतालीस", "बयालीस", "बियालीस", "तैंतालीस", "तेंतालीस",
  "चौवालीस", "चवालीस", "चव्वालीस", "पैंतालीस", "पेंतालीस", "छियालीस", "छयालीस", "सैंतालीस", "सेंतालीस", "अड़तालीस",
  "उनचास", "उन्चास", "पचास", "इक्यावन", "इकावन", "बावन", "तिरेपन", "तिरपन", "तरेपन", "चौवन", "चव्वन", "पचपन",
  "छप्पन", "सत्तावन", "सतावन", "अट्ठावन", "अठावन", "उनसठ", "उन्सठ", "साठ", "इकसठ", "बासठ", "तिरेसठ", "तिरसठ",
  "तरेसठ", "चौंसठ", "चौसठ", "पैंसठ", "पेंसठ", "छियासठ", "छयासठ", "सड़सठ", "सरसठ", "अड़सठ", "उनहत्तर", "सत्तर",
  "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर", "छिहत्तर", "छियत्तर", "सतहत्तर", "सत्तत्तर", "अठहत्तर",
  "उनासी", "उन्यासी", "उनयासी", "अस्सी", "इक्यासी", "बयासी", "बिरासी", "तिरासी", "तिरयासी", "चौरासी", "पचासी",
  "छियासी", "सत्तासी", "सतासी", "अट्ठासी", "अठासी", "नवासी", "नब्बे", "इक्यानबे", "इक्यानवे", "बानबे", "बानवे",
  "बयानवे", "तिरानबे", "तिरानवे", "तिरान्वे", "चौरानबे", "चौरानवे", "पंचानबे", "पंचानवे", "पचानवे", "पचानबे",
  "छियानबे", "छियानवे", "सत्तानबे", "सत्तानवे", "अट्ठानबे", "अट्ठानवे", "निन्यानबे", "निन्यानवे", "सौ", "सैकड़ा",
  "हज़ार", "लाख", "करोड़", "अरब", "खरब",
];
/** Ordinal endings (पाँचवाँ, दसवीं, सातवें) and plural ones (हज़ारों, दसियों) on a Hindi cardinal. */
export const HINDI_ENDINGS = ["वां", "वीं", "वें", "वा", "वी", "वे", "ों", "ियों"];

/**
 * Hindi cardinals in Latin letters, as people type them. Matched by skeleton (LATIN_SKELETON), so one spelling here
 * stands for its common variants: teen/tin, chaar/char, chhattis/chattis, sattar/satar, gyarah/gyara, hazaar/hajar.
 * "do", "teen", "char", "sat", "bees", "tees" are also English words, and "saath", "tera", "bara" Hindi ones: an answer
 * using them abstains. "no" and "so" (spellings of nau and sau) are left out.
 */
export const HINDI_LATIN_CARDINALS = [
  "shunya", "ek", "do", "teen", "chaar", "paanch", "panch", "chhah", "chhe", "chheh", "saat", "aath", "nau", "das",
  "dus", "gyarah", "barah", "terah", "chaudah", "chaudha", "pandrah", "pandhra", "solah", "satrah", "atharah",
  "unnis", "bees", "ikkis", "baais", "teis", "teyis", "chaubis", "chobis", "pachchis", "chhabbis", "sattais",
  "atthais", "untis", "unatis", "tees", "iktis", "ikattis", "battis", "taintis", "tetis", "tentis", "chauntis",
  "chautis", "chontis", "paintis", "pentis", "chhattis", "saintis", "sentis", "adtis", "artis", "untalis", "unchalis",
  "chalis", "iktalis", "ikatalis", "bayalis", "bialis", "biyalis", "taintalis", "tentalis", "chavalis", "chauvalis",
  "chaualis", "paintalis", "pentalis", "chhiyalis", "chhayalis", "chhialis", "saintalis", "sentalis", "adtalis",
  "artalis", "unchas", "pachaas", "ikyavan", "ikkyavan", "bavan", "tirpan", "tirepan", "tarepan", "chauvan",
  "chavvan", "pachpan", "chhappan", "sattavan", "atthavan", "unsath", "saath", "iksath", "ikasath", "basath",
  "tirsath", "tiresath", "taresath", "chausath", "chaunsath", "chonsath", "chosath", "painsath", "pensath",
  "chhiyasath", "chhayasath", "sadsath", "sarsath", "adsath", "arsath", "unhattar", "sattar", "ikhattar",
  "ikahattar", "bahattar", "behattar", "tihattar", "tehattar", "chauhattar", "chohattar", "pachhattar", "chhihattar",
  "chhiyattar", "sathattar", "satattar", "athhattar", "unasi", "unyasi", "assi", "ikyasi", "bayasi", "biyasi",
  "birasi", "tirasi", "chaurasi", "chorasi", "pachasi", "chhiyasi", "sattasi", "atthasi", "navasi", "nabbe",
  "ikyanave", "ikyanabe", "ikyanbe", "ikyanve", "banave", "banabe", "banbe", "banve", "bayanave", "tiranave",
  "tiranabe", "tiranbe", "tiranve", "chauranave", "chauranabe", "chauranbe", "chauranve", "pachanave", "panchanave",
  "pachanabe", "panchanabe", "panchanbe", "pachanve", "panchanve", "chhiyanave", "chhiyanabe", "chhiyanbe",
  "chhiyanve", "sattanave", "sattanabe", "sattanbe", "sattanve", "atthanave", "atthanabe", "atthanbe", "atthanve",
  "ninyanave", "ninyanabe", "ninyanbe", "ninyanve", "sau", "sainkda", "saikda", "hazaar", "lakh", "laakh", "karod",
  "karor", "arab", "kharab",
];
/** Ordinal endings on a Hindi cardinal in Latin letters: paanchvaan, dasvin, saatven. */
export const HINDI_LATIN_ENDINGS = ["van", "vin", "ven", "vein"];
/** How a Latin word is reduced to its skeleton before it is matched against HINDI_LATIN_CARDINALS, in order. */
export const LATIN_SKELETON: [RegExp, string][] = [
  [/chch|cch|chh/g, "ch"],
  [/w/g, "v"],
  [/z/g, "j"],
  [/ee/g, "i"],
  [/oo/g, "u"],
  [/ou/g, "au"],
  [/([a-z])\1+/g, "$1"],
  [/([aeiou])h$/, "$1"],
];

/** Numbers written as words, refused anywhere in an answer. */
export const NUMBER_WORDS: Record<"en" | "hi" | "hiLatn", string[]> = {
  en: [
    // cardinals and scales
    "zero", "nil", "nought", "naught", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
    "thirty", "forty", "fourty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "hundreds", "thousand",
    "thousands", "million", "millions", "billion", "billions", "trillion", "lakh", "lakhs", "lac", "lacs", "crore",
    "crores", "dozen", "dozens", "tens", "pair", "pairs", "couple", "score", "scores", "duo", "trio",
    // common misspellings
    "ninty", "nintey", "ninteen", "fivety", "twelth", "eigth", "nineth", "fiveth",
    // ordinals
    "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh",
    "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth",
    "twentieth", "thirtieth", "fortieth", "fiftieth", "sixtieth", "seventieth", "eightieth", "ninetieth", "hundredth",
    "thousandth", "millionth",
    // fractions and percent
    "half", "halves", "halve", "halved", "halving", "quarter", "quarters", "thirds", "fourths", "fifths", "sixths",
    "sevenths", "eighths", "ninths", "tenths", "hundredths", "thousandths", "percent", "pct", "cent",
    // multiplicatives
    "once", "twice", "thrice", "single", "double", "doubled", "doubles", "doubling", "triple", "tripled", "triples",
    "tripling", "treble", "trebled", "quadruple", "quadrupled", "twofold", "threefold", "fourfold", "fivefold",
    "tenfold", "hundredfold",
  ],
  hi: [
    ...HINDI_CARDINALS,
    "सैकड़ों", "सैंकड़ों", "दर्जन", "जोड़ा", "दोनों", "दहाई",
    // irregular ordinals (पहले "before" and दूसरे "others" are left out: in prose they are rarely ordinals)
    "पहला", "पहली", "दूसरा", "दूसरी", "तीसरा", "तीसरी", "तीसरे", "चौथा", "चौथी", "चौथे", "छठा", "छठी", "छठे",
    // fractions, decimals and percent
    "आधा", "आधी", "आधे", "डेढ़", "ढाई", "सवा", "साढ़े", "पौन", "पौना", "पौने", "चौथाई", "तिहाई", "प्रतिशत",
    "फ़ीसदी", "दशमलव",
    // multiplicatives
    "दोगुना", "दोगुनी", "दोगुने", "दुगना", "दुगनी", "दुगने", "दुगुना", "दुगुनी", "तिगुना", "तिगुनी", "चौगुना", "गुना",
    "गुनी", "गुने",
  ],
  // matched by skeleton, like HINDI_LATIN_CARDINALS
  hiLatn: [
    ...HINDI_LATIN_CARDINALS,
    "saikdon", "sainkdon", "hazaaron", "lakhon", "karodon", "karoron", "darjan", "pehla", "pahla", "pehli", "pahli",
    "doosra", "doosri", "teesra", "teesri", "chautha", "chauthi", "chhatha", "chhathi", "aadha", "aadhi", "aadhe",
    "dedh", "dhai", "sava", "saadhe", "paune", "pauna", "chauthai", "tihai", "pratishat", "fisadi", "dashamlav", "dugna",
    "dugni", "doguna", "tiguna", "chauguna", "guna", "gune", "guni",
  ],
};

/** Han numerals (Chinese, Japanese, Korean hanja), refused anywhere. 〇 and fullwidth digits are \p{N} already. */
export const CJK_NUMERALS = "零一二三四五六七八九十百千万萬亿億兆两兩壹贰貳叁參肆伍陆陸柒捌玖拾佰仟廿卅";

/** A Roman numeral in any case is a number (xii, XXIV, iv, c), except these English words: the pronoun I and "mix". */
export const ROMAN_WORDS = ["I", "mix", "Mix", "MIX"];

/** Letters that pass for digits: a word made only of them, with an O in it, reads as a number (lOO, IOO, OO). */
export const DIGIT_LIKE = "OoIl";
export const DIGIT_LIKE_WORDS = ["lo", "Lo", "loo", "Loo"];

/** A scale or magnitude beside a handle turns one number into another ("⟦1⟧ lakh", "minus ⟦1⟧", "⟦1⟧ point ⟦2⟧"). */
export const SCALE_WORDS = [
  "k", "m", "mn", "bn", "cr", "crs", "lac", "lacs", "lakh", "lakhs", "crore", "crores", "thousand", "thousands",
  "hundred", "hundreds", "million", "millions", "billion", "billions", "hazaar", "hazar", "हज़ार", "लाख", "करोड़",
  "percent", "pct", "प्रतिशत", "फ़ीसदी", "x", "times", "fold", "गुना", "half", "double", "twice", "triple",
  // signs and decimals, in words
  "minus", "negative", "neg", "point", "decimal", "dot", "ऋण", "दशमलव", "बिंदु", "माइनस", "नेगेटिव", "पॉइंट",
  // fractions
  "halves", "quarter", "quarters", "third", "thirds", "fourth", "fourths", "fifth", "fifths", "tenth", "tenths",
  "आधा", "आधी", "आधे", "चौथाई", "तिहाई", "पौन", "पौना", "पौने", "सवा", "साढ़े", "डेढ़", "ढाई",
];
export const SCALE_SIGNS = "%‰‱×*^÷½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞⁄";
/** A sign standing alone beside a handle ("- ⟦1⟧", "± ⟦1⟧"); inside a word ("best-selling ⟦1⟧") it is a hyphen. */
export const SIGNS = "-−–+±/";

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
 * and render as its text. A text cell from any other column that holds a digit is refused (it would read as a number),
 * and so is any text cell with no letter in it ("15000").
 */
export const NAME_COLUMNS = ["item", "supplier", "customer", "staff", "category", "bill_no", "latest_bill_no", "reference"];
/** Names of people and firms: a figure standing alone in one ("Sharma 50000") reads as an amount; an item's does not. */
export const PARTY_COLUMNS = ["supplier", "customer", "staff"];
