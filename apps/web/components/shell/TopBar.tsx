"use client";

import { useLang } from "../LangProvider";
import { Sticker } from "../Sticker";
import "./TopBar.css";

/** The header band: neem green on a phone and whenever there is no rail; on a desk with the rail it is a quiet strip
 *  (the rail carries the name) holding the "Synthetic data" label and the language. */
export function TopBar() {
  const { lang, t, setLang } = useLang();
  return (
    <header className="bar">
      <div className="wrap bar-in">
        <span className="bar-id">
          <span className="bar-mark" aria-hidden="true">
            M
          </span>
          <span className="word">Munshi</span>
        </span>
        <div className="bar-r">
          <Sticker tone="yellow">{t.syntheticData}</Sticker>
          <fieldset className="lang">
            <legend className="vh">{t.language}</legend>
            <input type="radio" name="lang" id="lang-en" checked={lang === "en"} onChange={() => setLang("en")} />
            <label htmlFor="lang-en" lang="en">
              EN
            </label>
            <input type="radio" name="lang" id="lang-hi" checked={lang === "hi"} onChange={() => setLang("hi")} />
            <label htmlFor="lang-hi" lang="hi">
              हिंदी
            </label>
          </fieldset>
        </div>
      </div>
    </header>
  );
}
