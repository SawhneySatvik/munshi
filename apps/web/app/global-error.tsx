"use client";

import "../styles/tokens.css";
import "../styles/base.css";
import "../components/Button.css";
import "../components/StatusNotice.css";

const WORDS = {
  en: { title: "Something went wrong", body: "Nothing in your books was changed.", again: "Try again" },
  hi: { title: "कुछ गड़बड़ हो गई", body: "आपके खातों में कुछ नहीं बदला।", again: "फिर कोशिश करें" },
};

// Renders when the root layout itself fails, so no LangProvider exists: the language comes from its cookie, fixed copy
// only, and English shows no Devanagari.
export default function GlobalError({ reset }: { reset: () => void }) {
  const lang = typeof document !== "undefined" && document.cookie.includes("munshi_lang=hi") ? "hi" : "en";
  const w = WORDS[lang];
  return (
    <html lang={lang}>
      <body>
        <main className="wrap status">
          <section className="pending" aria-labelledby="status-h">
            <h1 id="status-h">{w.title}</h1>
            <p className="status-body">{w.body}</p>
            <div className="status-actions">
              <button type="button" className="press press-primary" onClick={reset}>
                {w.again}
              </button>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
