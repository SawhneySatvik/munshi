import type { Lang } from "./types";

// The chat link screen's words, in both languages.
const en = {
  kicker: "Your account",
  title: "Chat link",
  lede: "Link your chat account so Munshi knows it's you in the staff group. What you can do there is what your role can do here.",
  codeHeading: "Link an account",
  codeNote: "Post this in the staff group, right away, from your own account. It works once and lasts thirty minutes.",
  getCode: "Get a code",
  codeFailed: "Couldn't make a code. Sign in again and retry.",
  linksHeading: "Your linked accounts",
  noLinks: "No chat account is linked yet.",
  linkedAccount: "Chat account",
  linkedOn: "Linked",
  until: "until",
  end: "Unlink",
};

const hi: typeof en = {
  kicker: "आपका खाता",
  title: "चैट लिंक",
  lede: "अपना चैट खाता जोड़ें, ताकि स्टाफ़ ग्रुप में Munshi आपको पहचान सके। वहाँ आप वही कर सकते हैं जो आपकी भूमिका यहाँ कर सकती है।",
  codeHeading: "खाता जोड़ें",
  codeNote: "इसे तुरंत अपने खाते से स्टाफ़ ग्रुप में भेजें। यह एक बार चलता है और तीस मिनट तक वैध है।",
  getCode: "कोड लें",
  codeFailed: "कोड नहीं बन सका। दोबारा साइन इन करके कोशिश करें।",
  linksHeading: "आपके जुड़े खाते",
  noLinks: "अभी कोई चैट खाता नहीं जुड़ा है।",
  linkedAccount: "चैट खाता",
  linkedOn: "जुड़ा",
  until: "तक",
  end: "हटाएँ",
};

export const CHAT: Record<Lang, typeof en> = { en, hi };
