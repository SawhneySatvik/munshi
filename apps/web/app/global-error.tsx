"use client";

import "../styles/tokens.css";
import "../styles/base.css";
import "../components/Button.css";
import "../components/StatusNotice.css";

// Renders when the root layout itself fails, so no LangProvider exists: both languages are shown, fixed copy only.
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="wrap status">
          <section className="pending" aria-labelledby="status-h">
            <h1 id="status-h">Something went wrong · कुछ गड़बड़ हो गई</h1>
            <p className="status-body">Nothing in your books was changed. · आपके खातों में कुछ नहीं बदला।</p>
            <div className="status-actions">
              <button type="button" className="press press-primary" onClick={reset}>
                Try again · फिर कोशिश करें
              </button>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
