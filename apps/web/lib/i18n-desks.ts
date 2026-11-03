import type { Lang, Localized } from "./types";

// The office's desks and run log: what each member of the AI staff's runs did, and each run's steps. Every count
// and every timing is a cell of a stored snapshot; these are the words around them, and carry no digits.
const en = {
  desksTitle: "The desks",
  desksNote: "What each of your AI staff did in the last seven days, counted from their runs and your decisions. Tap a figure for its source.",
  model: "Model",
  noModel: "none, it works by fixed rules",
  runs: "Runs",
  proposed: "Proposed",
  approved: "Approved",
  rejected: "Rejected",
  abstained: "Abstained",
  failed: "Failed",
  latest: "Latest run",
  noRuns: "No runs in the last seven days.",
  logTitle: "Run log",
  logNote: "Every run of the last seven days, newest first. Open a run for its steps.",
  // When the log holds core's LOG_ROWS (a hundred) runs: older runs of the window are not shown.
  logNoteCapped: "The newest hundred runs of the last seven days, newest first; older ones are not shown. Open a run for its steps.",
  logEmpty: "No runs in the last seven days.",
  logEmptyFor: "No runs by {name} in the last seven days.",
  filterLabel: "Show the runs of",
  everyone: "Everyone",
  openSteps: "Steps",
  closeSteps: "Close",
  stepsOf: "Steps of {name}'s run at {at}, run {code}",
  closeStepsOf: "Close the steps of {name}'s run at {at}, run {code}",
  steps: "Steps of this run",
  noSteps: "No steps recorded for this run.",
  alias: "model {alias}",
  ms: "{n} ms",
  stillRunning: "Still running",
  stepsLabel: "Run log · steps",
  weekLabel: "Desks · last seven days",
};
type DesksDict = typeof en;

const hi: DesksDict = {
  desksTitle: "डेस्क",
  desksNote: "पिछले सात दिनों में आपके हर AI कर्मचारी ने क्या किया, उनके रन और आपके फ़ैसलों से गिना हुआ। स्रोत देखने के लिए आँकड़े पर टैप करें।",
  model: "मॉडल",
  noModel: "कोई नहीं, तय नियमों से काम करता है",
  runs: "रन",
  proposed: "प्रस्ताव",
  approved: "मंज़ूर",
  rejected: "नामंज़ूर",
  abstained: "जवाब नहीं दिया",
  failed: "विफल",
  latest: "आख़िरी रन",
  noRuns: "पिछले सात दिनों में कोई रन नहीं।",
  logTitle: "रन का लेखा",
  logNote: "पिछले सात दिनों का हर रन, सबसे नया पहले। किसी रन के क़दम देखने के लिए उसे खोलें।",
  logNoteCapped: "पिछले सात दिनों के सबसे नए सौ रन, सबसे नया पहले; पुराने नहीं दिखाए गए। किसी रन के क़दम देखने के लिए उसे खोलें।",
  logEmpty: "पिछले सात दिनों में कोई रन नहीं।",
  logEmptyFor: "पिछले सात दिनों में {name} का कोई रन नहीं।",
  filterLabel: "इनके रन दिखाएँ",
  everyone: "सभी",
  openSteps: "क़दम",
  closeSteps: "बंद करें",
  stepsOf: "{name} के {at} वाले रन के क़दम, रन {code}",
  closeStepsOf: "{name} के {at} वाले रन के क़दम बंद करें, रन {code}",
  steps: "इस रन के क़दम",
  noSteps: "इस रन का कोई क़दम दर्ज नहीं।",
  alias: "मॉडल {alias}",
  ms: "{n} मिलीसेकंड",
  stillRunning: "अभी चल रहा है",
  stepsLabel: "रन का लेखा · क़दम",
  weekLabel: "डेस्क · पिछले सात दिन",
};

export const DESKS: Record<Lang, DesksDict> = { en, hi };

/** How a run ended (ai.run's outcome). */
export const OUTCOME: Record<string, Localized> = {
  answered: { en: "Answered", hi: "जवाब दिया" },
  abstained: { en: "Abstained", hi: "जवाब नहीं दिया" },
  proposed: { en: "Proposed a draft", hi: "मसौदा रखा" },
  raised: { en: "Raised findings", hi: "निष्कर्ष उठाए" },
  failed: { en: "Failed", hi: "विफल" },
  budget: { en: "Stopped at the budget", hi: "बजट पर रुका" },
  off: { en: "AI is off", hi: "AI बंद है" },
};

/** What started a run (ai.run's trigger). */
export const TRIGGER: Record<string, Localized> = {
  question: { en: "a question", hi: "एक सवाल" },
  voice: { en: "a voice note", hi: "एक वॉइस नोट" },
  watcher: { en: "the watchers", hi: "निगरानी" },
  brief: { en: "the morning brief", hi: "सुबह की रिपोर्ट" },
  photo: { en: "a photo", hi: "एक फ़ोटो" },
  inbox: { en: "the inbox", hi: "इनबॉक्स" },
  campaign: { en: "a campaign", hi: "एक अभियान" },
  recipe: { en: "a fix", hi: "एक सुधार" },
};

/** A trace step's kind (ai.trace's kind). */
export const STEP: Record<string, Localized> = {
  route: { en: "Routed", hi: "भेजा" },
  model: { en: "Model call", hi: "मॉडल से पूछा" },
  read: { en: "Read the books", hi: "बही पढ़ी" },
  budget: { en: "Budget check", hi: "बजट जाँच" },
  validate: { en: "Checked", hi: "जाँचा" },
  answer: { en: "Answered", hi: "जवाब दिया" },
  abstain: { en: "Abstained", hi: "जवाब नहीं दिया" },
  propose: { en: "Proposed", hi: "प्रस्ताव रखा" },
  evidence: { en: "Kept evidence", hi: "सबूत रखा" },
  watch: { en: "Watched", hi: "निगरानी की" },
  recipe: { en: "Fix recipe", hi: "सुधार का तरीक़ा" },
};
