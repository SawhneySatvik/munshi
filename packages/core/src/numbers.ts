// One number detector for core and the agent, and the span parser that reads a figure from
// a transcript (0016). The agent's cite-or-abstain validator and core's checks on text bound for a book row or a
// customer (campaign copy, replies) call these same functions, so core's backstop is exactly as strict as the agent.
// The word lists and the detector were moved here verbatim from packages/agent/src/{words,answer}.ts, double quotes
// included: the red-proofs in db/test/v2/sabotage/packages.ts break them by their exact source text. Nothing here reads or writes
// a database.
import type { Cell, CellRef } from "./read.ts";
import { addDays, daysBetween } from "./time.ts";

// ---- The word lists (were packages/agent/src/words.ts) ----------------------------------------------------------------

// The word lists cite-or-abstain refuses (the detector below reads them; add a word here, not a branch there). Entries are
// matched after the same folding as the prose: NFKC, format characters removed, accents on Latin letters removed, the
// Devanagari nukta removed, chandrabindu read as anusvara, lower case. A false refusal costs an abstention; a missing
// word can let a number through, so when a word is both a number and something else, it is listed unless noted.

/**
 * Hindi cardinals 0–100 in the spellings in use (several for many numbers), and the scales. Each is also refused with
 * an ordinal or plural ending (HINDI_ENDINGS). एक is also the article "a" and दो the verb "give": in an answer they are
 * read by HOMOGRAPHS (a number only in a quantity context); everywhere else they are numbers.
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
 * "do", "teen", "tin", "char", "sat", "bees", "tees" are also English words: in an answer they are read by HOMOGRAPHS.
 * "saath", "tera", "bara", "kharab" are also Hindi words but not English ones, so an answer using them abstains (it
 * keeps a Latin Hindi number that is not an English word unambiguous). "no" and "so" (spellings of nau and sau) are left
 * out.
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
    "crores", "dozen", "dozens", "tens", "pair", "pairs", "duo", // "couple", "score", "trio": HOMOGRAPHS
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
  "rs", "inr", "rupee", "rupees", "re", "paise", "paisa", "usd", "aud", "eur", "gbp", "dollar", "dollars", "rupaye",
  "rupaiye", "rupay", "rupaya", "rupiya", "rupiye", "rupye", "रुपये", "रुपए", "रुपया", "रु", "पैसे",
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

// ---- homographs, numbers only in a quantity context --------------------------------------------------------
// In an answer (answerRules), these words are numbers only where a quantity is being said; anywhere else they are the
// ordinary word ("do not", "a tin of ghee", "the score", "i.e.", "मुझे बता दो"). Shelf phrases (textRules) still read
// every one as a number. What a quantity context is, is answer.ts's quantityContext; the words that make one are below.

/** The words read in context: Latin Hindi numbers that are English words, collective numerals, lone Roman letters, एक/दो. */
export const HOMOGRAPHS = {
  latin: ["do", "teen", "tin", "char", "sat", "bees", "tees"],
  collective: ["couple", "score", "scores", "trio"],
  roman: ["i", "c", "d", "l", "m", "v", "x"],
  hindi: ["एक", "दो"],
};

/**
 * Nouns of what a shop counts (people, bills, goods, time): a homograph directly before one, or across "of" and
 * modifiers, is a count ("do customers", "a couple of bills", "दो नए ग्राहक"). Hindi nouns do not mark the plural, so
 * ग्राहक and बिल count as they are; English singulars are listed only where they are never a verb after "do" (so no
 * "note": "do note that").
 */
export const COUNT_NOUNS = [
  "customers", "customer", "bills", "items", "item", "products", "product", "suppliers", "supplier", "orders", "sales",
  "sale", "payments", "payment", "invoices", "receipts", "receipt", "entries", "entry", "days", "day", "weeks", "week",
  "months", "month", "years", "year", "hours", "hour", "minutes", "times", "time", "people", "person", "persons",
  "staff", "workers", "employees", "helpers", "members", "shops", "brands", "bottles", "bottle", "bags", "bag", "jars",
  "jar", "sachets", "sachet", "cartons", "carton", "crates", "crate", "tins", "cans", "trays", "bundles", "strips",
  "rolls", "notes", "coins",
  "grahak", "grahakon", "log", "logon", "aadmi", "din", "dino", "dinon", "hafte", "hafta", "haftey", "mahine", "mahina",
  "mahino", "saal", "ghante", "ghanta", "baar", "bill", "saman", "samaan", "maal", "cheez", "cheezein", "cheezen",
  "cheeze", "dabba", "dabbe", "bori", "botal", "botlen", "peti", "thaila", "thaile", "kisht", "kist", "hissa",
  "hisse",
  "ग्राहक", "ग्राहकों", "लोग", "लोगों", "आदमी", "दिन", "दिनों", "हफ़्ते", "हफ़्ता", "हफ़्तों", "महीने", "महीना", "महीनों", "साल",
  "सालों", "घंटे", "घंटा", "बार", "बिल", "बिलों", "सामान", "माल", "चीज़", "चीज़ें", "चीज़ों", "आइटम", "ऑर्डर", "सप्लायर",
  "भुगतान", "किस्त", "किस्तें", "एंट्री", "रसीद", "रसीदें", "नोट", "बोतल", "बोतलें", "बोरी", "बोरियां", "पेटी", "थैली",
  "थैले", "हिस्से", "हिस्सा", "कर्मचारी",
];

/** Words skipped between a homograph and its count noun ("do naye grahak", "दो और पैकेट", "a couple of new customers"). */
export const MODIFIERS = [
  "new", "old", "more", "extra", "other", "big", "small", "large", "fresh", "full", "empty", "unpaid", "overdue",
  "pending", "open", "regular", "loyal", "recent", "late", "early", "separate", "different", "same", "whole", "entire",
  "loose", "damaged", "dented", "expired", "missing", "remaining", "additional", "local", "top", "best",
  "naye", "naya", "nayi", "purane", "purana", "purani", "bade", "bada", "badi", "chhote", "chhota", "chhoti", "aur",
  "zyada", "jyada", "khaali", "khali", "bhare", "baaki", "baki", "alag", "poore", "mehenge", "mehnge", "saste", "khule",
  "नए", "नये", "नया", "नई", "पुराने", "पुराना", "पुरानी", "बड़े", "बड़ा", "बड़ी", "छोटे", "छोटा", "छोटी", "और", "ज़्यादा",
  "ख़ाली", "भरे", "बाकी", "बाक़ी", "अलग", "पूरे", "महंगे", "सस्ते", "खुले",
];

/** Before "tin": the container ("a tin of ghee"), so "of" does not lead on to a count. After "of": skipped. */
export const DETERMINERS = ["a", "an", "the", "each", "every", "per", "this", "that", "these", "those", "his", "her", "their", "its", "your", "my", "our", "any", "no"];
/** "teen of them": a pronoun after "of" is what is counted. */
export const OF_PRONOUNS = ["them", "these", "those", "us"];

/** A word before teen, tin, char, bees, tees or एक that reads it as an amount ("only teen are left", "सिर्फ़ एक बचा"). */
export const QUANTIFIERS = [
  "only", "just", "about", "around", "nearly", "almost", "roughly", "exactly", "approximately", "approx", "over",
  "under", "another", "by", "than", "total", "sirf", "bas", "kul", "lagbhag", "karib", "kareeb", "takriban",
  "सिर्फ़", "केवल", "बस", "कुल", "लगभग", "करीब", "क़रीब", "मात्र", "तकरीबन",
];

/** Words that follow एक only where it is the number ("एक बचा है", "एक ही", "एक भी नहीं"): the article takes a noun. */
export const AFTER_EK = [
  "बचा", "बचे", "बची", "बाकी", "बाक़ी", "बिका", "बिके", "बिकी", "आया", "आए", "आई", "मिला", "मिले", "मिली", "गया", "गए", "गई",
  "है", "हैं", "था", "थे", "थी", "ही", "भी", "रहा", "रहे", "रही", "हुआ", "हुए", "हुई",
];

/**
 * A verb stem that makes the next "do" / दो its imperative ("kar do", "बता दो"). It is still refused when a handle, a
 * unit, a count noun or a name follows it with nothing but a space between ("bhej do ⟦1⟧" may be "send two ⟦1⟧").
 */
export const LIGHT_VERBS = [
  "kar", "de", "dila", "bata", "bhej", "lauta", "gin", "chuka", "rakh", "likh", "dikha", "bula", "mangwa", "mangva",
  "manga", "chhod", "chod", "bana", "bhar", "khol", "badal", "laga", "hata", "utha", "nikal", "samjha", "suna", "chala",
  "jod", "ghata", "badha", "bhijwa", "karwa", "likhwa", "nipta", // not "dal"/"daal": also the lentil
  "कर", "दे", "दिला", "बता", "भेज", "लौटा", "गिन", "चुका", "रख", "लिख", "दिखा", "बुला", "मंगवा", "मंगा", "छोड़", "बना", "भर",
  "खोल", "बदल", "लगा", "हटा", "डाल", "उठा", "निकाल", "समझा", "सुना", "चला", "जोड़", "घटा", "बढ़ा", "भिजवा", "करवा", "लिखवा",
  "पहुंचा", "निपटा", "सुलझा",
];

/**
 * Hindi function words in Latin letters: a sentence with one (or with any Devanagari) is Hindi, and in it a Latin
 * homograph is the Hindi number ("⟦1⟧ ke teen bache hain"), except "do" after a light verb and "do not". Words that are
 * also English ones (par, to, is, me, the, hi, ho, mile, mere) are left out.
 */
export const HINGLISH_WORDS = [
  "hai", "hain", "tha", "thi", "ka", "ke", "ki", "ko", "ne", "se", "mein", "aur", "nahi", "nahin", "nhi", "bhi", "kya",
  "kyun", "kyon", "aaj", "kal", "abhi", "wala", "wale", "wali", "waala", "waale", "liye", "bache", "bacha", "bachi",
  "baaki", "baki", "raha", "rahe", "rahi", "gaya", "gaye", "gayi", "hua", "hue", "hui", "diya", "diye", "liya", "kiya",
  "kiye", "kar", "karo", "karna", "karke", "kijiye", "dijiye", "lijiye", "chahiye", "sabse", "zyada", "jyada", "kam",
  "tak", "sirf", "lekin", "phir", "agar", "toh", "yeh", "woh", "unka", "unke", "unki", "inka", "inke", "inki", "iska",
  "iske", "iski", "uska", "uske", "uski", "aap", "aapka", "aapke", "aapki", "apka", "apke", "apki", "mujhe", "mera",
  "meri", "humne", "hamara", "humara", "hoga", "hogi", "honge", "aaya", "aaye", "aayi", "aya", "mila", "mili", "bika",
  "biki", "becha", "beche", "bechi", "khatam", "baad", "pehle", "kitna", "kitne", "kitni", "kuch", "bahut", "accha",
  "achha", "theek", "thik", "bilkul", "jaldi", "agle", "pichle",
];

/** Words of a name from the reads that say nothing about the thing named ("Gupta Traders (simulated)" is "gupta"). */
export const NAME_STOPWORDS = [
  "simulated", "the", "and", "for", "with", "traders", "trader", "wholesale", "store", "stores", "shop", "company",
  "enterprises", "agency", "agencies", "mart", "kirana", "general", "sons", "bros",
];

// ---- The detector (was packages/agent/src/answer.ts) ------------------------------------------------------------------

// A handle is one whole number from one cell, so the prose may not build a number around it (from the
// guarantee review): no digit, number symbol or emoji (💯, 🔟, keycaps); no number in words (English; Hindi in Devanagari
// and in Latin letters, with ordinal and plural endings; Han numerals; Roman numerals in any case; letters that pass for
// digits, "lOO"); no letter outside the Latin and Devanagari scripts (the lists cannot read them, so "இருபத்து நான்கு"
// is refused whole); no two handles run together or joined only by glue ("⟦1⟧⟦2⟧", "⟦1⟧.⟦2⟧"); nothing glued onto a
// handle but brackets, quotes and closing punctuation ("-⟦1⟧", "⟦1⟧th"); no scale, sign, decimal, fraction, currency or
// unit beside one ("⟦1⟧ lakh", "minus ⟦1⟧", "⟦1⟧ point ⟦2⟧", "₹⟦1⟧", "⟦1⟧ packs"): a money cell renders its own sign and
// a quantity cell its own unit. The word lists are data (above). The text is checked and rendered in one folded
// form (NFKC, format characters removed), so what passed is what shows.
//
// Homographs: a word that is a number and also an ordinary word (do, teen, tin, char, sat, bees, tees; couple,
// score, trio; a lone Roman letter; एक, दो) is a number in an answer only in a quantity context (quantityContext), so
// "do not", "a tin of ghee", "i.e." and "मुझे बता दो" pass and "do ⟦1⟧", "tees packets", "teen dozen" do not. Shelf
// phrases (textRules) still read every homograph as a number. The precision corpus is packages/agent/test/corpus/.
//
// Names: a text cell renders as text. Its digits are part of the name only when the segment cites it from a name
// column (NAME_COLUMNS: "Glucose biscuits 70 g", bill GT-1013); a text cell from any other column that holds a digit
// or a number word is refused, and no text cell may carry a currency sign ("Sharma (owes ₹50,000)"). A text cell with no
// letter ("15000"), or the name of a person or firm with a figure standing alone in it ("Sharma 50000"), is refused too.
// An id column, or a text cell shaped like a uuid, is never cited: the owner never sees an id.

export const RULES = [
  "free_digit",
  "number_word",
  "other_script",
  "handle_glue",
  "scale_word",
  "unit_or_currency",
  "unknown_handle",
  "id_ref",
  "not_this_run",
  "unresolved",
  "not_a_name",
] as const;
export type Rule = (typeof RULES)[number];

export const HANDLE = /⟦([1-9][0-9]{0,2})⟧/g;
// Any Unicode number (ASCII and Devanagari digits, ½, ², Ⅻ …), a percent or per-mille sign, or a symbol or emoji (💯,
// 🔟, a keycap, a die face: no list of the ones that mean a number could be complete), once the handles are out.
const NUMBERISH = /[\p{N}%‰‱\p{So}\p{Extended_Pictographic}]|\u20e3/u;

/** The form an answer is checked and shown in: compatibility forms folded (fullwidth, ligatures, ₨), format characters gone. */
export const shown = (text: string) => text.normalize("NFKC").replace(/\p{Cf}/gu, "");
/** Also no accents on Latin letters ("dō" is "do", "ïï" is "ii"). */
const unaccented = (text: string) => shown(text).normalize("NFD").replace(/([A-Za-z])\p{M}+/gu, "$1");
/** The form a word is matched in: also no nukta, chandrabindu as anusvara, lower case. */
const fold = (text: string) => unaccented(text).replace(/\u093c/g, "").replace(/\u0901/g, "\u0902").toLowerCase();
const skeleton = (w: string) => LATIN_SKELETON.reduce((s, [from, to]) => s.replace(from, to), w);

const NUMBER = new Set([...NUMBER_WORDS.en, ...NUMBER_WORDS.hi].map(fold));
const ENGLISH = new Set(NUMBER_WORDS.en.map(fold));
const HINDI = new Set(HINDI_CARDINALS.map(fold));
const HINDI_ENDS = HINDI_ENDINGS.map(fold);
const LATIN = new Set(NUMBER_WORDS.hiLatn.map((w) => skeleton(fold(w))));
const LATIN_CARDINAL = new Set(HINDI_LATIN_CARDINALS.map((w) => skeleton(fold(w))));
const SCALE = new Set(SCALE_WORDS.map(fold));
const UNIT = new Set([...UNIT_WORDS, ...CURRENCY_WORDS].map(fold));
const CURRENCY = new Set(CURRENCY_WORDS.map(fold));
const CJK = new RegExp(`[${CJK_NUMERALS}]`, "u");
const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const ROMAN = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LATIN_HOMOGRAPH = new Set(HOMOGRAPHS.latin);
const COLLECTIVE = new Set(HOMOGRAPHS.collective);
const ROMAN_LETTER = new Set(HOMOGRAPHS.roman);
const [EK, DO] = HOMOGRAPHS.hindi.map(fold) as [string, string];
const HOMOGRAPH = new Set([...HOMOGRAPHS.latin, ...HOMOGRAPHS.collective, ...HOMOGRAPHS.hindi].map(fold));
const COUNT = new Set(COUNT_NOUNS.map(fold));
const MODIFIER = new Set(MODIFIERS.map(fold));
const DETERMINER = new Set(DETERMINERS);
const OF_PRONOUN = new Set(OF_PRONOUNS);
const QUANTIFIER = new Set(QUANTIFIERS.map(fold));
const LIGHT_VERB = new Set(LIGHT_VERBS.map(fold));
const HINGLISH = new Set(HINGLISH_WORDS);
const NAME_STOP = new Set(NAME_STOPWORDS);
const AFTER_ONE = new Set(AFTER_EK.map(fold));
// "sat" and "do" are ordinary after "just" or "only" ("it just sat there", "only do a recount"); the others are not.
const QUANTIFIED = new Set(["teen", "tin", "char", "bees", "tees", EK]);

// Glue allowed on a handle: opening brackets and quotes before it; closing ones, a possessive and sentence or list
// punctuation after it. Between two handles: a word, or list punctuation and a space ("⟦1⟧, ⟦2⟧", "⟦1⟧ (⟦2⟧)").
const OPENERS = /^[(["'“‘]*$/u;
const CLOSERS = /^(?:['’]s)?[)\]"'”’.,;:!?…।॥]*$/u;
const SEPARATOR = /[.,;:!?…।॥]/u;
const LIST_GAP = /^[)\]"'”’]*[,;.:!?।]?\s+[(["'“‘]*$/u;
const GAP_MARK = /[,;.:!?।()[\]"'“”‘’]/u;

// "twentyfour": a word made only of English number words.
function compound(w: string): boolean {
  const ok = [true];
  for (let i = 1; i <= w.length; i++) ok[i] = ok.slice(0, i).some((o, j) => o && ENGLISH.has(w.slice(j, i)));
  return ok[w.length] === true;
}

// A folded word that is a number: listed, an English compound, a Hindi cardinal with an ordinal or plural ending, or
// Hindi in Latin letters by its skeleton (with or without an ordinal ending).
function isNumber(w: string): boolean {
  if (NUMBER.has(w) || compound(w)) return true;
  if (HINDI_ENDS.some((e) => w.endsWith(e) && HINDI.has(w.slice(0, -e.length)))) return true;
  if (!/^[a-z]+$/.test(w)) return false;
  const s = skeleton(w);
  // the rest is skeletoned again: "gyarahvaan" keeps the h that "gyarah" alone drops
  return LATIN.has(s) || HINDI_LATIN_ENDINGS.some((e) => s.endsWith(e) && LATIN_CARDINAL.has(skeleton(s.slice(0, -e.length))));
}

// A number in words. With `names` (an answer), a homograph counts only in a quantity context; without (a shelf phrase,
// a text cell), every homograph is a number.
function numberWord(text: string, names?: ReadonlySet<string>): boolean {
  const plain = unaccented(text).replace(HANDLE, " ");
  if (CJK.test(plain)) return true;
  for (const m of plain.matchAll(WORD)) {
    const w = m[0];
    // A lone letter against an apostrophe is a contraction or an elision ("we'd", "I'm", "L'Oréal"), not a numeral; in
    // an answer any lone letter is read by quantityContext.
    const elided = w.length === 1 && (names !== undefined || /['’]/.test(`${plain[m.index - 1]}${plain[m.index + 1]}`));
    if (!elided && ROMAN.test(w.toUpperCase()) && !ROMAN_WORDS.includes(w)) return true;
    if (w.length > 1 && /[Oo]/.test(w) && [...w].every((c) => DIGIT_LIKE.includes(c)) && !DIGIT_LIKE_WORDS.includes(w)) return true;
  }
  const words = fold(plain).match(WORD) ?? [];
  if (words.some(glued)) return true;
  if (!names) return words.some((w) => isNumber(w) || HOMOGRAPH.has(w));
  return words.some((w) => isNumber(w) && !HOMOGRAPH.has(w)) || quantityContext(text, names);
}

// A homograph glued to a unit, a currency or a count noun is one ("teenpackets", "do\u2060packets" once the joiner is
// folded away, "दोपैकेट"); the tail has three letters or more, so "dog" and "satin" are words.
const GLUE_TAIL = new Set([...UNIT, ...COUNT].filter((w) => w.length >= 3));
const glued = (w: string) => [...HOMOGRAPH].some((h) => w.length > h.length && w.startsWith(h) && GLUE_TAIL.has(w.slice(h.length)));

// "i.e." and "e.g." are abbreviations: not a Roman i, and not a gram beside a handle.
const unabbreviated = (text: string) => text.replace(/(?<![\p{L}\p{M}])(?:(i)\.\s?e|e\.\s?g)\.(?![\p{L}\p{M}])/giu, (_, i) => (i ? "ie" : "eg"));

// A word keeps its apostrophes ("I'm", "we'd", "L'Oréal" are not lone letters) and a handle its possessive ("⟦1⟧'s").
const TOKEN = /⟦[1-9][0-9]{0,2}⟧(?:['’]s)?|[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}]+)*/gu;
const CLAUSE_END = /[.!?;।॥…]/u;
const SPACED = /^\s+$/u;
const CHAINED = /^[\s\-‐‑]+$/u; // a space or a hyphen: "do naye grahak", "teen-packet"
const signIn = (gap: string) => /\p{Sc}/u.test(gap) || [...gap].some((c) => SCALE_SIGNS.includes(c));

/**
 * Whether a homograph in an answer stands where a quantity is said. Beside a word means with nothing between but spaces
 * and binding marks (brackets, quotes, dashes, colons, commas, except a comma after "do"); a clause ends at . ! ? ; । and
 * … A homograph is a number when:
 * - a handle, a unit or currency, a scale or number word, or a name from this run's reads is beside it, or a currency or
 *   scale sign ("do ⟦1⟧", "⟦1⟧ teen", "tees rupees", "teen dozen", "teen Maggi", "do ₹");
 * - a count noun follows it, directly or (but for एक and a lone letter) across "of", a determiner and modifiers ("do
 *   customers", "a couple of new customers", "teen of the bills", "दो और पैकेट");
 * - it ends its clause after a colon or a dash ("Left: teen", "बचे हुए पैकेट: दो"), or it is a sentence by itself
 *   ("teen? ⟦1⟧", "⟦1⟧. Teen.");
 * - teen, tin, char, bees, tees or एक follows a quantifier ("only teen", "सिर्फ़ एक", "उनमें से एक"), or एक comes before
 *   a verb or particle that only the number takes ("एक बचा है", "एक ही");
 * - it is दो, or a Latin homograph in a Hindi sentence (one with Devanagari or a Hindi function word in Latin letters:
 *   "⟦1⟧ ke teen bache hain"), unless it is "do"/दो after a light verb ("kar do", "बता दो") with no handle, unit, count
 *   noun or name directly after it.
 * "do not" is never a number, and "a tin of" is the container.
 */
function quantityContext(text: string, names: ReadonlySet<string>): boolean {
  const t = fold(unabbreviated(text));
  const toks = [...t.matchAll(TOKEN)].map((m) => ({ w: m[0], handle: m[0].startsWith("⟦"), start: m.index, end: m.index + m[0].length }));
  const before = (i: number) => t.slice(toks[i - 1]?.end ?? 0, toks[i]?.start);
  const after = (i: number) => t.slice(toks[i]?.end, toks[i + 1]?.start ?? t.length);
  const hindi: boolean[] = [];
  let sentence = 0;
  const sentenceOf = toks.map((tok, i) => {
    if (i > 0 && CLAUSE_END.test(before(i))) sentence++;
    hindi[sentence] ||= /\p{Script=Devanagari}/u.test(tok.w) || HINGLISH.has(tok.w);
    return sentence;
  });
  const amount = (k: number) => {
    const tok = toks[k] as (typeof toks)[number];
    return tok.handle || UNIT.has(tok.w) || SCALE.has(tok.w) || (isNumber(tok.w) && !HOMOGRAPH.has(tok.w)) || names.has(tok.w);
  };
  for (const [i, tok] of toks.entries()) {
    const w = tok.w;
    if (!ROMAN_LETTER.has(w) && !LATIN_HOMOGRAPH.has(w) && !COLLECTIVE.has(w) && w !== EK && w !== DO) continue;
    const p = i > 0 && !CLAUSE_END.test(before(i)) ? i - 1 : null;
    // English "do" ends its clause at a comma too ("if you do, ⟦1⟧ …").
    const n = i + 1 < toks.length && !CLAUSE_END.test(after(i)) && !(w === "do" && after(i).includes(",")) ? i + 1 : null;
    if (w === "do" && n !== null && toks[n]?.w === "not" && SPACED.test(after(i))) continue;
    const verb = toks[p ?? -1];
    if ((w === "do" || w === DO) && verb && SPACED.test(before(i)) && LIGHT_VERB.has(verb.w) && !names.has(verb.w)) {
      if (n !== null && SPACED.test(after(i)) && (amount(n) || COUNT.has(toks[n]?.w ?? ""))) return true;
      continue;
    }
    if ((p !== null && amount(p)) || (n !== null && amount(n)) || signIn(before(i)) || signIn(after(i))) return true;
    if (/[:=\-–—]\s*$/u.test(before(i)) && /^\s*(?:[.!?;।॥…,]|$)/u.test(after(i))) return true;
    if (p === null && n === null) return true;
    if (QUANTIFIED.has(w) && p !== null && QUANTIFIER.has(toks[p]?.w ?? "")) return true;
    if (w === EK && p !== null && toks[p]?.w === "से" && /में$/u.test(toks[p - 1]?.w ?? "")) return true;
    if (w === EK && n !== null && AFTER_ONE.has(toks[n]?.w ?? "")) return true;
    if (w === DO || (LATIN_HOMOGRAPH.has(w) && hindi[sentenceOf[i] as number])) return true;
    // The count noun after it, across "of", a determiner and modifiers for the Latin and collective words.
    let j = i + 1;
    const chained = (k: number) => k < toks.length && CHAINED.test(after(k - 1));
    if (LATIN_HOMOGRAPH.has(w) || COLLECTIVE.has(w)) {
      if (chained(j) && toks[j]?.w === "of" && (COLLECTIVE.has(w) || !DETERMINER.has(toks[p ?? -1]?.w ?? ""))) {
        j++;
        if (chained(j) && OF_PRONOUN.has(toks[j]?.w ?? "")) return true;
        while (chained(j) && DETERMINER.has(toks[j]?.w ?? "")) j++;
      }
      while (chained(j) && MODIFIER.has(toks[j]?.w ?? "")) j++;
    }
    const target = j === i + 1 ? n : chained(j) ? j : null;
    if (target !== null && (COUNT.has(toks[target]?.w ?? "") || amount(target))) return true;
  }
  return false;
}

/** The words of the names in a run's reads that can mark a count beside a homograph ("Maggi noodles" → maggi, noodles). */
export function nameWords(names: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const name of names) {
    for (const w of fold(name).match(WORD) ?? []) {
      if (w.length >= 3 && !/\p{N}/u.test(w) && !NAME_STOP.has(w) && !HOMOGRAPH.has(w) && !UNIT.has(w) && !SCALE.has(w)) out.add(w);
    }
  }
  return out;
}

// The scripts the word lists read: Latin (accents aside) and Devanagari. A letter of any other script is refused.
const otherScript = (text: string) => /[\p{L}\p{M}]/u.test(unaccented(text).replace(/[A-Za-z]|\p{Script=Devanagari}/gu, ""));

// What a chunk of text beside a handle adds to it: a scale, a currency or a unit.
function beside(chunk: string, out: Set<Rule>): void {
  for (const ch of chunk) {
    if (/\p{Sc}/u.test(ch)) out.add("unit_or_currency");
    if (SCALE_SIGNS.includes(ch)) out.add("scale_word");
  }
  if (!/\p{L}/u.test(chunk) && [...chunk].some((ch) => SIGNS.includes(ch))) out.add("scale_word");
  for (const w of fold(chunk.replace(HANDLE, " ")).match(WORD) ?? []) {
    if (UNIT.has(w)) out.add("unit_or_currency");
    if (SCALE.has(w)) out.add("scale_word");
  }
}

function aroundHandles(text: string, out: Set<Rule>): void {
  const handles = [...text.matchAll(HANDLE)];
  for (const [i, h] of handles.entries()) {
    const start = h.index;
    const end = start + h[0].length;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const gluedBefore = (/\S*$/u.exec(before) as RegExpExecArray)[0];
    const gluedAfter = (/^\S*/u.exec(after) as RegExpExecArray)[0];
    if (!OPENERS.test(gluedBefore)) {
      out.add("handle_glue");
      beside(gluedBefore, out);
    }
    if (!CLOSERS.test(gluedAfter)) {
      out.add("handle_glue");
      beside(gluedAfter, out);
    }
    const prev = /(\S+)\s+$/u.exec(before.slice(0, before.length - gluedBefore.length))?.[1];
    if (prev) beside(prev, out); // always: "Rs. ⟦1⟧" ends in a full stop
    const next = /^\s+(\S+)/u.exec(after.slice(gluedAfter.length))?.[1];
    if (next && !SEPARATOR.test(gluedAfter)) beside(next, out);
    const following = handles[i + 1];
    if (following) {
      const gap = text.slice(end, following.index);
      if (!/\p{L}/u.test(gap) && !(GAP_MARK.test(gap) && LIST_GAP.test(gap))) out.add("handle_glue");
    }
  }
}

export const freeDigit = (text: string) => NUMBERISH.test(text.replace(HANDLE, "")) || NUMBERISH.test(shown(text).replace(HANDLE, ""));

export function rulesOf(text: string, names?: ReadonlySet<string>): Rule[] {
  const out = new Set<Rule>();
  if (freeDigit(text)) out.add("free_digit");
  if (numberWord(text, names)) out.add("number_word");
  if (otherScript(text)) out.add("other_script");
  aroundHandles(unabbreviated(shown(text)), out);
  return RULES.filter((r) => out.has(r));
}

/** The rules a text breaks on its own (no refs needed), in RULES order, every homograph read as a number (shelf phrases). */
export const textRules = (text: string): Rule[] => rulesOf(text);

/** The rules an answer segment's text breaks on its own: a homograph is a number only in a quantity context, `names`
 * (the names in this run's reads) included. */
export const answerRules = (text: string, names: Iterable<string> = []): Rule[] => rulesOf(text, nameWords(names));

export const idRef = (ref: CellRef) => ref.col === "id" || ref.col.endsWith("_id");

/** The rule a resolved cell breaks as cited from its column, if any. */
export function cellRule(ref: CellRef, cell: Cell): Rule | null {
  if (cell.kind !== "text") return null;
  if (UUID.test(cell.txt.trim())) return "id_ref";
  const t = shown(cell.txt);
  // An amount planted in a name: a currency sign (in the raw text too, since NFKC folds ₨ to the letters Rs) or word.
  if (/\p{Sc}/u.test(cell.txt + t) || (fold(t).match(WORD) ?? []).some((w) => CURRENCY.has(w))) return "not_a_name";
  if (!NAME_COLUMNS.includes(ref.col) && (NUMBERISH.test(t) || numberWord(t))) return "not_a_name";
  if (!/\p{L}/u.test(t)) return "not_a_name"; // "15000" is no name
  if (PARTY_COLUMNS.includes(ref.col) && loneFigure(t)) return "not_a_name";
  return null;
}

// A word of digits (and digit punctuation) that no unit follows: "Sharma 50000", not "Butter 100 g".
function loneFigure(t: string): boolean {
  const words = t.split(/\s+/).filter(Boolean);
  return words.some((w, i) => /\p{N}/u.test(w) && !/\p{L}/u.test(w) && !UNIT.has(fold(words[i + 1] ?? "").replace(/[^\p{L}]/gu, "")));
}


// ---- The span parser (0016) -------------------------------------------------------------------------------------------

// The model points at a span of a transcript and code reads the figure in it, or refuses with a reason and fills
// nothing (the person then types the figure as their own); it never guesses. Offsets count code points, as Postgres
// counts characters, so the extract trigger's substring and hash see this same text. It reads:
// - digits of one script (ASCII, Devanagari, the other Indian scripts, Arabic-Indic, fullwidth), grouped strictly the
//   Indian (1,23,456) or Western (123,456) way or not at all; an amount takes up to two decimals, a count none;
// - a rupee form before (₹, Rs, Rs., INR, रु) or after (Rs, rupaye and its spellings, rupees, रुपये …) an amount;
// - Hindi (Devanagari or Latin letters) and English cardinals 0–99, composed with sau, hazaar, lakh and karod in falling
//   order, each part below the scale before it ("do lakh pachaas hazaar"), and dedh, dhai, sava, saadhe and paune
//   ("dhai hazaar", "saadhe teen sau", "paune do sau", "sava sau");
// - a date: aaj, kal or parson (kal and parson are both before and after today, so the caller says which way), today,
//   tomorrow, yesterday, a weekday (never on that weekday itself: this one or the next), or a day and a month with an
//   optional year (without one, the next such day on or after today, or the last one on or before it).
// Refused: a percent or rate, digits of two scripts in one number, grouping that is neither way, digits beside words
// ("5 hazaar"), another currency, paise, and every word or form not listed here.

export type Span = { start: number; end: number };
export type SpanAsk = { field: "amount" } | { field: "quantity" } | { field: "date"; today: string; direction: "next" | "last" };
export type SpanRefusal = "bad_span" | "unreadable" | "grouping" | "decimals" | "not_whole" | "mixed_script" | "percent" | "ambiguous" | "range";
/** `parsedAs` is "digits" exactly when the database re-reads the span itself (0016); "words" are read by core alone. */
export type SpanRead =
  | { ok: true; field: "amount"; minor: number; currency: "INR"; parsedAs: "digits" | "words" }
  | { ok: true; field: "quantity"; count: number; parsedAs: "digits" | "words" }
  | { ok: true; field: "date"; day: string }
  | { ok: false; refusal: SpanRefusal };

/** The zero of each digit script read (each runs zero to nine); any other digit is refused. */
export const DIGIT_ZEROS = [0x30, 0x660, 0x6f0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0x1c50, 0xabf0, 0xff10];

/** Hindi cardinals by value, in Devanagari and in Latin letters: every spelling of HINDI_CARDINALS and
 * HINDI_LATIN_CARDINALS below a hundred (a test holds them in step). सौ, हज़ार, लाख, करोड़ are scales (SPAN_SCALES);
 * सैकड़ा, अरब and खरब are not read. */
export const SPAN_HINDI = `
0 शून्य shunya
1 एक ek
2 दो do
3 तीन teen
4 चार chaar
5 पांच paanch panch
6 छह छः छे छ chhah chhe chheh
7 सात saat
8 आठ aath
9 नौ nau
10 दस das dus
11 ग्यारह gyarah
12 बारह barah
13 तेरह terah
14 चौदह chaudah chaudha
15 पंद्रह पन्द्रह pandrah pandhra
16 सोलह solah
17 सत्रह satrah
18 अठारह अट्ठारह atharah
19 उन्नीस unnis
20 बीस bees
21 इक्कीस ikkis
22 बाईस baais
23 तेईस teis teyis
24 चौबीस chaubis chobis
25 पच्चीस pachchis
26 छब्बीस chhabbis
27 सत्ताईस सताईस sattais
28 अट्ठाईस अठाईस atthais
29 उनतीस उन्तीस untis unatis
30 तीस tees
31 इकतीस इकत्तीस iktis ikattis
32 बत्तीस battis
33 तैंतीस तेंतीस तेतीस taintis tetis tentis
34 चौंतीस चौतीस chauntis chautis chontis
35 पैंतीस पेंतीस paintis pentis
36 छत्तीस chhattis
37 सैंतीस सेंतीस saintis sentis
38 अड़तीस adtis artis
39 उनतालीस उन्तालीस untalis unchalis
40 चालीस chalis
41 इकतालीस iktalis ikatalis
42 बयालीस बियालीस bayalis bialis biyalis
43 तैंतालीस तेंतालीस taintalis tentalis
44 चौवालीस चवालीस चव्वालीस chavalis chauvalis chaualis
45 पैंतालीस पेंतालीस paintalis pentalis
46 छियालीस छयालीस chhiyalis chhayalis chhialis
47 सैंतालीस सेंतालीस saintalis sentalis
48 अड़तालीस adtalis artalis
49 उनचास उन्चास unchas
50 पचास pachaas
51 इक्यावन इकावन ikyavan ikkyavan
52 बावन bavan
53 तिरेपन तिरपन तरेपन tirpan tirepan tarepan
54 चौवन चव्वन chauvan chavvan
55 पचपन pachpan
56 छप्पन chhappan
57 सत्तावन सतावन sattavan
58 अट्ठावन अठावन atthavan
59 उनसठ उन्सठ unsath
60 साठ saath
61 इकसठ iksath ikasath
62 बासठ basath
63 तिरेसठ तिरसठ तरेसठ tirsath tiresath taresath
64 चौंसठ चौसठ chausath chaunsath chonsath chosath
65 पैंसठ पेंसठ painsath pensath
66 छियासठ छयासठ chhiyasath chhayasath
67 सड़सठ सरसठ sadsath sarsath
68 अड़सठ adsath arsath
69 उनहत्तर unhattar
70 सत्तर sattar
71 इकहत्तर ikhattar ikahattar
72 बहत्तर bahattar behattar
73 तिहत्तर tihattar tehattar
74 चौहत्तर chauhattar chohattar
75 पचहत्तर pachhattar
76 छिहत्तर छियत्तर chhihattar chhiyattar
77 सतहत्तर सत्तत्तर sathattar satattar
78 अठहत्तर athhattar
79 उनासी उन्यासी उनयासी unasi unyasi
80 अस्सी assi
81 इक्यासी ikyasi
82 बयासी बिरासी bayasi biyasi birasi
83 तिरासी तिरयासी tirasi
84 चौरासी chaurasi chorasi
85 पचासी pachasi
86 छियासी chhiyasi
87 सत्तासी सतासी sattasi
88 अट्ठासी अठासी atthasi
89 नवासी navasi
90 नब्बे nabbe
91 इक्यानबे इक्यानवे ikyanave ikyanabe ikyanbe ikyanve
92 बानबे बानवे बयानवे banave banabe banbe banve bayanave
93 तिरानबे तिरानवे तिरान्वे tiranave tiranabe tiranbe tiranve
94 चौरानबे चौरानवे chauranave chauranabe chauranbe chauranve
95 पंचानबे पंचानवे पचानवे पचानबे pachanave panchanave pachanabe panchanabe panchanbe pachanve panchanve
96 छियानबे छियानवे chhiyanave chhiyanabe chhiyanbe chhiyanve
97 सत्तानबे सत्तानवे sattanave sattanabe sattanbe sattanve
98 अट्ठानबे अट्ठानवे atthanave atthanabe atthanbe atthanve
99 निन्यानबे निन्यानवे ninyanave ninyanabe ninyanbe ninyanve
`;
export const SPAN_ENGLISH_UNITS = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen";
export const SPAN_ENGLISH_TENS = "twenty thirty forty fifty sixty seventy eighty ninety";
export const SPAN_SCALES: [string, number][] = [
  ["सौ", 100], ["sau", 100], ["hundred", 100], ["हज़ार", 1000], ["hazaar", 1000], ["thousand", 1000], ["लाख", 100_000],
  ["lakh", 100_000], ["lakhs", 100_000], ["lac", 100_000], ["lacs", 100_000], ["करोड़", 10_000_000], ["karod", 10_000_000],
  ["karor", 10_000_000], ["crore", 10_000_000], ["crores", 10_000_000],
];
/** In quarters of one: dedh and dhai stand for a number; sava, saadhe and paune add to or take from the next one. */
export const SPAN_WHOLES: [string, number][] = [["डेढ़", 6], ["dedh", 6], ["ढाई", 10], ["dhai", 10]];
export const SPAN_ADDS: [string, number][] = [["सवा", 1], ["sava", 1], ["साढ़े", 2], ["saadhe", 2], ["पौने", -1], ["paune", -1]];
const SPAN_ANDS = ["and", "aur", "और"];
/** The rupee forms an amount may carry, before or after it. */
const RUPEE_BEFORE = /^(?:₹|₨|rs\.?|inr|रु\.?)\s*/iu;
const RUPEE_AFTER = /\s*(?:rs\.?|rupaye|rupaiye|rupay|rupaya|rupiya|rupiye|rupye|rupee|rupees|रुपये|रुपए|रुपया|रु\.?)$/iu;
const PERCENT_WORDS = ["percent", "pct", "cent", "प्रतिशत", "फ़ीसदी", "फ़ीसद", "pratishat", "fisadi"];
/** Weekdays from Sunday (0) and months from January (1): English, Latin-letter Hindi (by skeleton) and Devanagari. */
const WEEKDAYS = `
0 sunday ravivaar itvaar रविवार इतवार
1 monday somvaar सोमवार
2 tuesday mangalvaar मंगलवार
3 wednesday budhvaar बुधवार
4 thursday guruvaar brihaspativaar veervaar गुरुवार बृहस्पतिवार वीरवार
5 friday shukravaar शुक्रवार
6 saturday shanivaar शनिवार
`;
const MONTHS = `
1 january jan जनवरी
2 february feb फ़रवरी
3 march mar मार्च
4 april apr अप्रैल
5 may मई
6 june jun जून
7 july jul जुलाई
8 august aug अगस्त
9 september sep sept सितंबर सितम्बर
10 october oct अक्टूबर अक्तूबर
11 november nov नवंबर नवम्बर
12 december dec दिसंबर दिसम्बर
`;
/** Days from today; "kal" and "parson" take the caller's direction. */
const DAY_WORDS: [string, number | "kal" | "parson"][] = [
  ["aaj", 0], ["आज", 0], ["today", 0], ["tomorrow", 1], ["yesterday", -1], ["kal", "kal"], ["कल", "kal"], ["parson", "parson"],
  ["parso", "parson"], ["परसों", "parson"],
];
const A_SUNDAY = "2023-01-01";

// A folded word's key: Latin letters by skeleton (one spelling stands for its variants), anything else as folded.
const wordKey = (w: string) => (/^[a-z]+$/.test(w) ? skeleton(w) : w);
const keyed = <V>(pairs: [string, V][]) => new Map(pairs.map(([w, v]) => [wordKey(fold(w)), v]));
const table = (text: string) =>
  keyed(
    text
      .trim()
      .split("\n")
      .flatMap((line) => {
        const [n, ...spellings] = line.split(" ");
        return spellings.map((s): [string, number] => [s, Number(n)]);
      }),
  );
const HINDI_VALUE = table(SPAN_HINDI);
const ENGLISH_VALUE = new Map([...SPAN_ENGLISH_UNITS.split(" ").map((w, n): [string, number] => [w, n]), ...SPAN_ENGLISH_TENS.split(" ").map((w, i): [string, number] => [w, (i + 2) * 10])]);
const SCALE_VALUE = keyed(SPAN_SCALES);
const WHOLE_VALUE = keyed(SPAN_WHOLES);
const ADD_VALUE = keyed(SPAN_ADDS);
const PERCENT = new Set(PERCENT_WORDS.map((w) => wordKey(fold(w))));
const WEEKDAY = table(WEEKDAYS);
const MONTH = table(MONTHS);
const DAY_WORD = keyed(DAY_WORDS);

const refuse = (refusal: SpanRefusal): SpanRead => ({ ok: false, refusal });

// A run of digits (and grouping marks) as ASCII, if every digit is of one listed script.
function asciiDigits(run: string): { ascii: string } | { refusal: SpanRefusal } {
  let zero: number | undefined;
  let ascii = "";
  for (const ch of run) {
    if (ch === "," || ch === ".") {
      ascii += ch;
      continue;
    }
    const cp = ch.codePointAt(0) as number;
    const z = DIGIT_ZEROS.find((d) => cp >= d && cp <= d + 9);
    if (z === undefined) return { refusal: "unreadable" };
    if (zero !== undefined && z !== zero) return { refusal: "mixed_script" };
    zero = z;
    ascii += String(cp - z);
  }
  return { ascii };
}

function amountOrCount(field: "amount" | "quantity", whole: bigint, fraction: string, parsedAs: "digits" | "words"): SpanRead {
  if (field === "quantity") {
    if (fraction) return refuse("not_whole");
    return whole > BigInt(Number.MAX_SAFE_INTEGER) ? refuse("range") : { ok: true, field, count: Number(whole), parsedAs };
  }
  if (fraction.length > 2) return refuse("decimals");
  const minor = whole * 100n + BigInt(fraction.padEnd(2, "0"));
  return minor > BigInt(Number.MAX_SAFE_INTEGER) ? refuse("range") : { ok: true, field, minor: Number(minor), currency: "INR", parsedAs };
}

// Digits with an optional rupee form, read from the text as it is (no compatibility folding: "²" is not "2"); null
// when the text is not a figure in digits.
function digitFigure(text: string, field: "amount" | "quantity"): SpanRead | null {
  const before = RUPEE_BEFORE.exec(text)?.[0] ?? "";
  const after = before ? "" : (RUPEE_AFTER.exec(text)?.[0] ?? "");
  const body = text.slice(before.length, text.length - after.length);
  if (!/^\p{Nd}[\p{Nd},.]*$/u.test(body)) return null;
  if ((before || after) && field !== "amount") return refuse("unreadable");
  const read = asciiDigits(body);
  if ("refusal" in read) return refuse(read.refusal);
  const { ascii } = read;
  if (ascii.includes(",") && !/^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})(?:\.\d+)?$/.test(ascii)) return refuse("grouping");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(ascii.replaceAll(",", ""));
  if (!m) return refuse("unreadable");
  return amountOrCount(field, BigInt(m[1] as string), m[2] ?? "", "digits");
}

type Part = { n: number; tens?: boolean; unit?: boolean } | { scale: number } | { whole: number } | { add: number } | { and: true };

function part(w: string): Part | null {
  const k = wordKey(w);
  if (SPAN_ANDS.includes(w)) return { and: true };
  const scale = SCALE_VALUE.get(k);
  if (scale !== undefined) return { scale };
  const whole = WHOLE_VALUE.get(k);
  if (whole !== undefined) return { whole };
  const add = ADD_VALUE.get(k);
  if (add !== undefined) return { add };
  const en = ENGLISH_VALUE.get(w);
  if (en !== undefined) return { n: en, tens: en >= 20, unit: en >= 1 && en <= 9 };
  const hi = HINDI_VALUE.get(k);
  return hi === undefined ? null : { n: hi };
}

// The number the words make, in quarters of one, or null. Groups fall in scale (karod, lakh, hazaar, sau, then the
// units), each below the scale of the group before it; "and" joins two groups.
function quartersOf(words: string[]): number | null {
  const parts = words.map(part);
  if (parts.some((p) => p === null)) return null;
  const at = (i: number) => parts[i] as Part | undefined;
  let total = 0;
  let above = Number.POSITIVE_INFINITY;
  let i = 0;
  while (i < parts.length) {
    if (i > 0) {
      const joint = at(i);
      if (joint && "and" in joint) i++;
      if (i === parts.length) return null;
    }
    let add = 0;
    const first = at(i);
    if (first && "add" in first) {
      add = first.add;
      i++;
    }
    let q: number | null = null;
    const mult = at(i);
    if (mult && "whole" in mult && !add) {
      q = mult.whole;
      i++;
    } else if (mult && "n" in mult) {
      q = mult.n * 4;
      i++;
      const unit = at(i);
      if (mult.tens && unit && "unit" in unit && unit.unit) {
        q += unit.n * 4;
        i++;
      }
    }
    const s = at(i);
    const scale = s && "scale" in s ? s.scale : 1;
    if (scale > 1) i++;
    if (q === null) {
      if (scale === 1 || add === 2) return null; // a bare scale is one of it ("sau", "sava sau"), never "saadhe sau"
      q = 4;
    }
    q += add;
    if (q === 0 && (scale > 1 || add !== 0 || parts.length > 1)) return null; // zero only alone
    if (q < 0 || (scale > 1 && q >= 400) || scale >= above || q * scale >= above * 4) return null;
    total += q * scale;
    above = scale;
    if (scale === 1 && i < parts.length) return null; // the units come last
  }
  return total;
}

// A figure in words, read from the folded text (a rupee form stripped first, for an amount).
function wordFigure(text: string, field: "amount" | "quantity"): SpanRead {
  let t = fold(text).trim();
  const before = RUPEE_BEFORE.exec(t)?.[0] ?? "";
  const after = before ? "" : (RUPEE_AFTER.exec(t)?.[0] ?? "");
  if ((before || after) && field !== "amount") return refuse("unreadable");
  t = t.slice(before.length, t.length - after.length);
  const words = t.split(/[\s\-‐‑]+/u).filter(Boolean);
  if (!words.length || !words.every((w) => /^[\p{L}\p{M}]+$/u.test(w))) return refuse("unreadable");
  const q = quartersOf(words);
  if (q === null) return refuse("unreadable");
  if (field === "quantity") return q % 4 ? refuse("not_whole") : amountOrCount(field, BigInt(q / 4), "", "words");
  return { ok: true, field, minor: q * 25, currency: "INR", parsedAs: "words" };
}

const isDay = (day: string) => {
  try {
    return addDays(day, 0) === day;
  } catch {
    return false;
  }
};
const pad = (n: number) => String(n).padStart(2, "0");

function dateFigure(text: string, ask: { today: string; direction: "next" | "last" }): SpanRead {
  const sign = ask.direction === "next" ? 1 : -1;
  // A token of digits is read as it is; any other is folded and looked up.
  const tokens = text.split(/\s+/u).map((raw) => {
    if (!/^\p{Nd}+$/u.test(raw)) return { word: wordKey(fold(raw)) };
    const read = asciiDigits(raw);
    return "refusal" in read ? read : { digits: read.ascii };
  });
  for (const t of tokens) if ("refusal" in t) return refuse(t.refusal);
  const [a, b, c] = tokens as ({ word: string } | { digits: string })[];
  if (tokens.length === 1 && a && "word" in a) {
    const rel = DAY_WORD.get(a.word);
    if (rel !== undefined) return { ok: true, field: "date", day: addDays(ask.today, typeof rel === "number" ? rel : sign * (rel === "kal" ? 1 : 2)) };
    const weekday = WEEKDAY.get(a.word);
    if (weekday === undefined) return refuse("unreadable");
    const today = ((daysBetween(A_SUNDAY, ask.today) % 7) + 7) % 7;
    const ahead = (((weekday - today) * sign) % 7 + 7) % 7;
    return ahead === 0 ? refuse("ambiguous") : { ok: true, field: "date", day: addDays(ask.today, sign * ahead) };
  }
  if (tokens.length < 2 || tokens.length > 3) return refuse("unreadable");
  const [dayTok, monthTok] = a && "digits" in a ? [a, b] : [b, a];
  const month = monthTok && "word" in monthTok ? MONTH.get(monthTok.word) : undefined;
  if (!dayTok || !("digits" in dayTok) || month === undefined || dayTok.digits.length > 2) return refuse("unreadable");
  if (c && !("digits" in c && c.digits.length === 4)) return refuse("unreadable");
  const date = Number(dayTok.digits);
  const thisYear = Number(ask.today.slice(0, 4));
  const on = (y: number) => `${String(y).padStart(4, "0")}-${pad(month)}-${pad(date)}`;
  let day = c && "digits" in c ? on(Number(c.digits)) : on(thisYear);
  if (!c && sign * (day < ask.today ? -1 : day > ask.today ? 1 : 0) < 0) day = on(thisYear + sign);
  return isDay(day) ? { ok: true, field: "date", day } : refuse("unreadable");
}

/** Reads the figure in a span of a transcript (offsets in code points), or says why it cannot. */
export function readSpan(transcript: string, span: Span, ask: SpanAsk): SpanRead {
  const chars = [...transcript];
  const { start, end } = span;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > chars.length || start >= end) return refuse("bad_span");
  const text = chars.slice(start, end).join("").trim();
  if (!text) return refuse("unreadable");
  const folded = fold(text);
  if (/[%‰‱٪]/u.test(folded) || (folded.match(WORD) ?? []).some((w) => PERCENT.has(wordKey(w)))) return refuse("percent");
  if (ask.field === "date") return dateFigure(text, ask);
  return digitFigure(text, ask.field) ?? wordFigure(text, ask.field);
}
