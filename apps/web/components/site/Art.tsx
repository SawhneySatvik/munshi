"use client";

import type { ReactNode } from "react";
import type { Lang } from "../../lib/types";
import { useLang } from "../LangProvider";

// The founder's paintings of the shop, framed on the site's dark ground. Each comes at two widths in public/art.
const ALT = {
  ask: {
    en: "A shopkeeper in a checked shirt speaks into his phone at the counter, jars and packets behind him.",
    hi: "चेक वाली कमीज़ में दुकानदार काउंटर पर फ़ोन में बोल रहा है, पीछे बरनियाँ और पैकेट हैं।",
  },
  bill: {
    en: "Over the shopkeeper's shoulder: his hand flattens a crumpled supplier's bill while his phone photographs it.",
    hi: "दुकानदार के कंधे के ऊपर से: एक हाथ मुड़े-तुड़े बिल को दबाए है और फ़ोन उसकी फ़ोटो ले रहा है।",
  },
  close: {
    en: "At night under a street lamp, the shopkeeper pulls down his shop's shutter, smiling, a dog asleep nearby.",
    hi: "रात में बत्ती के नीचे दुकानदार मुस्कुराते हुए शटर गिरा रहा है, पास में कुत्ता सो रहा है।",
  },
  credit: {
    en: "The shopkeeper writes in the credit book at the counter and looks up as a customer waves from the bright street.",
    hi: "दुकानदार काउंटर पर उधार बही लिख रहा है और धूप भरी गली से हाथ हिलाते ग्राहक को देख रहा है।",
  },
  dawn: {
    en: "Before sunrise, the shopkeeper stands in his lit shop reading his phone while the street is still blue and quiet.",
    hi: "सूरज निकलने से पहले दुकानदार रोशन दुकान में फ़ोन पढ़ रहा है, गली अभी नीली और शांत है।",
  },
  lane: {
    en: "A market lane at dusk: shops lit up under coloured awnings, people walking past.",
    hi: "शाम की बाज़ार गली: रंगीन छज्जों के नीचे रोशन दुकानें, गुज़रते लोग।",
  },
  notebook: {
    en: "Late at night the shopkeeper rests his head on his hand, writing in a thick ledger by a single bulb.",
    hi: "देर रात एक बल्ब की रोशनी में दुकानदार सिर पर हाथ रखे मोटी बही लिख रहा है।",
  },
  rush: {
    en: "The counter at rush hour: the shopkeeper hands a bag across, phone in his other hand, customers crowding in.",
    hi: "भीड़ के समय काउंटर: दुकानदार थैला थमा रहा है, दूसरे हाथ में फ़ोन, ग्राहक आसपास खड़े हैं।",
  },
  "shelf-gaps": {
    en: "A shelf with stacks of red and yellow packets at either end and a long empty gap between them.",
    hi: "शेल्फ़ के दोनों सिरों पर लाल और पीले पैकेटों के ढेर, बीच में लंबी ख़ाली जगह।",
  },
  "shelf-photo": {
    en: "The shopkeeper holds up his phone and photographs a shelf of packets and jars.",
    hi: "दुकानदार फ़ोन उठाकर पैकेटों और बरनियों वाली शेल्फ़ की फ़ोटो ले रहा है।",
  },
  shop: {
    en: "An empty kirana in morning light: full shelves of packets and jars behind a steel counter, a hanging scale.",
    hi: "सुबह की रोशनी में ख़ाली किराना दुकान: स्टील के काउंटर के पीछे भरी शेल्फ़ें, लटकता तराज़ू।",
  },
} satisfies Record<string, Record<Lang, string>>;

export type ArtName = keyof typeof ALT;

const file = (name: ArtName, width: number) => `/art/${name}-${width}.webp`;

/** One painting in its frame. `sizes` is what the layout gives it. */
export function Art({
  name,
  sizes,
  className = "",
  eager,
  children,
}: {
  name: ArtName;
  sizes: string;
  className?: string;
  eager?: boolean;
  children?: ReactNode;
}) {
  const { lang } = useLang();
  return (
    <div className={`s-art ${className}`.trim()}>
      <img
        src={file(name, 800)}
        srcSet={`${file(name, 800)} 800w, ${file(name, 1600)} 1600w`}
        sizes={sizes}
        width={1600}
        height={900}
        alt={ALT[name][lang]}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
      />
      {children}
    </div>
  );
}
