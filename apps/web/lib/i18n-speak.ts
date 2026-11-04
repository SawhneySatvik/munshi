import type { Lang } from "./types";

// Read aloud's words, in English and Hindi. No digits: what is read aloud is the checked text on the screen, its
// figures the cells the screen shows; these are only the button's words around it.
const en = {
  readAloudAnswer: "Read this answer aloud",
  readAloudBrief: "Read the brief aloud",
  stop: "Stop reading",
  loading: "Getting the voice ready",
  recorded: "Demo voice: a stand-in clip, not a live voice",
  notFound: "There is nothing checked here to read aloud.",
  off: "Reading aloud is off for this shop now, or today's voice and photo calls are spent.",
  noKey: "Reading aloud is not set up here yet.",
  failed: "The voice could not be made just now. Nothing changed.",
  noPlay: "This browser would not play the voice.",
};

export type SpeakDict = typeof en;

const hi: SpeakDict = {
  readAloudAnswer: "यह जवाब पढ़कर सुनाएँ",
  readAloudBrief: "सुबह की रिपोर्ट पढ़कर सुनाएँ",
  stop: "पढ़ना रोकें",
  loading: "आवाज़ तैयार हो रही है",
  recorded: "डेमो आवाज़: नमूने की क्लिप, असली आवाज़ नहीं",
  notFound: "यहाँ पढ़कर सुनाने लायक जाँचा हुआ कुछ नहीं है।",
  off: "इस दुकान के लिए अभी पढ़कर सुनाना बंद है, या आज की आवाज़ और फ़ोटो वाली सीमा पूरी हो गई।",
  noKey: "यहाँ पढ़कर सुनाना अभी चालू नहीं है।",
  failed: "अभी आवाज़ नहीं बन सकी। कुछ नहीं बदला।",
  noPlay: "यह ब्राउज़र आवाज़ नहीं चला सका।",
};

export const SPEAK: Record<Lang, SpeakDict> = { en, hi };
