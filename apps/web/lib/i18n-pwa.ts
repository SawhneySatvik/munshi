import type { Lang } from "./types";

// The installable app's words: the offline view, the banner, the install prompt, and the
// Muse Spark Open credit. Every figure on the offline view is a stored cell; these words carry no digits.
const en = {
  offlineOpenedAt: "Offline · this page as opened at {when}",
  offlineTitle: "Your shop, as last read",
  offlineLede: "What this device kept the last time you opened it. Nothing can be recorded or approved until you are back online.",
  offlineNothing: "Nothing is kept on this device yet. Open your home and your stock while online, and they will be here next time.",
  offlineStale: "This page was opened on this device more than a day ago, so Munshi shows no figure from it. Open the app online to read your books again.",
  offlineHome: "Home",
  offlineStock: "Stock",
  offlineRecord: "Record a count",
  offlineNeedsNet: "Needs a connection",
  offlineBack: "Back to the app",
  bannerOffline: "You are offline. Showing what was last read; nothing can be recorded.",
  bannerOnline: "Back online.",
  updateReady: "A new version of Munshi is ready.",
  updateReload: "Reload",
  installTitle: "Put Munshi on your home screen",
  installBody: "Open it like an app, straight to your shop.",
  installButton: "Install",
  installIos: "In Safari, tap Share (on a newer iPhone it is under the ••• button), then Add to Home Screen.",
  installDismiss: "Not now",
  builtWithMuse: "Built with Muse Spark Open",
};
type PwaDict = typeof en;

const hi: PwaDict = {
  offlineOpenedAt: "ऑफ़लाइन · यह पेज जैसा {when} पर खुला था",
  offlineTitle: "आपकी दुकान, जैसी पिछली बार पढ़ी गई",
  offlineLede: "पिछली बार खोलने पर इस डिवाइस ने जो रखा। ऑनलाइन लौटने तक कुछ भी दर्ज या मंज़ूर नहीं हो सकता।",
  offlineNothing: "इस डिवाइस पर अभी कुछ नहीं रखा है। ऑनलाइन रहते अपना होम और स्टॉक खोलें, अगली बार वे यहाँ होंगे।",
  offlineStale: "यह पेज इस डिवाइस पर एक दिन से ज़्यादा पहले खुला था, इसलिए मुंशी उससे कोई संख्या नहीं दिखाता। अपनी बही फिर पढ़ने के लिए ऐप ऑनलाइन खोलें।",
  offlineHome: "होम",
  offlineStock: "स्टॉक",
  offlineRecord: "गिनती दर्ज करें",
  offlineNeedsNet: "कनेक्शन चाहिए",
  offlineBack: "ऐप पर लौटें",
  bannerOffline: "आप ऑफ़लाइन हैं। पिछली बार पढ़ा हुआ दिख रहा है; कुछ भी दर्ज नहीं हो सकता।",
  bannerOnline: "फिर से ऑनलाइन।",
  updateReady: "मुंशी का नया संस्करण तैयार है।",
  updateReload: "फिर से खोलें",
  installTitle: "मुंशी को होम स्क्रीन पर रखें",
  installBody: "ऐप की तरह खोलें, सीधे अपनी दुकान पर।",
  installButton: "इंस्टॉल करें",
  installIos: "Safari में शेयर दबाएँ (नए iPhone पर यह ••• बटन में है), फिर होम स्क्रीन पर जोड़ें।",
  installDismiss: "अभी नहीं",
  builtWithMuse: "Muse Spark Open से बना",
};

export const PWA: Record<Lang, PwaDict> = { en, hi };
