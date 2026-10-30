// <munshi-order>: built from packages/widgets (node packages/widgets/scripts/build.ts). Do not edit.
"use strict";
(() => {
  // ../sdk/src/money.ts
  var CANNOT_VERIFY = "Cannot verify";
  var REF = /^⟨snap:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})·([0-9]{1,6})·([a-z_][a-z0-9_]{0,62})⟩$/;
  function traces(figure) {
    const refs = "ref" in figure ? [figure.ref] : figure.from;
    return Number.isSafeInteger(figure.minor) && /^[A-Z]{3}$/.test(figure.currency) && Array.isArray(refs) && refs.length > 0 && refs.every((r) => typeof r === "string" && REF.test(r));
  }
  function formatMoney(figure, locale = "en-IN") {
    if (!traces(figure)) return CANNOT_VERIFY;
    const digits = new Intl.NumberFormat("en", { style: "currency", currency: figure.currency }).resolvedOptions().maximumFractionDigits ?? 2;
    const scale = 10n ** BigInt(digits);
    const minor = BigInt(figure.minor);
    const abs = minor < 0n ? -minor : minor;
    const fraction = abs % scale;
    const decimal = `${minor < 0n ? "-" : ""}${abs / scale}${fraction ? `.${fraction.toString().padStart(digits, "0")}` : ""}`;
    const shown = fraction ? digits : 0;
    return new Intl.NumberFormat(locale, { style: "currency", currency: figure.currency, minimumFractionDigits: shown, maximumFractionDigits: shown }).format(
      decimal
    );
  }

  // ../sdk/src/index.ts
  var CODES = {
    invalid: true,
    idempotency_key_required: true,
    stale_notice: true,
    bot_check: true,
    unauthenticated: true,
    not_found: true,
    slot_taken: true,
    idempotency_mismatch: true,
    gone: true,
    payload_too_large: true,
    unsupported_media_type: true,
    rate_limited: true,
    hold_limit: true,
    intake_paused: true,
    internal: true
  };
  var FIELD = /^[A-Za-z0-9_.-]{1,100}$/;
  var KEY = /^mpk_[a-z][a-z0-9-]{2,39}_[A-Za-z0-9_-]{43}$/;
  var IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;
  var REQUEST_ID = /^[A-Za-z0-9:_-]{1,128}$/;
  var MunshiError = class extends Error {
    status;
    code;
    requestId;
    fields;
    constructor(status, code, requestId, fields = []) {
      super(`Munshi API error ${code} (HTTP ${status})`);
      this.name = "MunshiError";
      this.status = status;
      this.code = code;
      this.requestId = requestId;
      this.fields = fields;
    }
  };
  function randomToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function newIdempotencyKey() {
    return randomToken();
  }
  function deviceStore() {
    let memory;
    return () => {
      try {
        const stored = globalThis.localStorage?.getItem("munshi.device");
        if (stored) return stored;
        const made = randomToken();
        globalThis.localStorage?.setItem("munshi.device", made);
        if (globalThis.localStorage) return made;
      } catch {
      }
      memory ??= randomToken();
      return memory;
    };
  }
  function createClient(options) {
    const base = `${options.baseUrl.replace(/\/+$/, "")}/api/v1`;
    const key = options.key;
    if (key !== void 0 && !KEY.test(key)) throw new Error("createClient: key is not a publishable key (mpk_<slug>_…)");
    const device = deviceStore();
    async function send(method, path, params, query, headers, body) {
      let url = `${base}${path.replace(/\{([a-z]+)\}/g, (_, name) => {
        const value = params[name];
        if (value === void 0) throw new Error(`munshi: missing path parameter ${name}`);
        return encodeURIComponent(String(value));
      })}`;
      const search = new URLSearchParams();
      for (const [k, v] of Object.entries(query ?? {})) if (v !== void 0) search.set(k, String(v));
      const qs = search.toString();
      if (qs) url += `?${qs}`;
      const init = { method, headers: { accept: "application/json", ...headers }, credentials: "omit" };
      if (body !== void 0) {
        init.body = JSON.stringify(body);
        init.headers["content-type"] = "application/json";
      }
      const res = await fetch(url, init);
      const requestId = res.headers.get("x-request-id");
      let data;
      try {
        data = await res.json();
      } catch {
        data = void 0;
      }
      if (!res.ok || data === void 0) throw toError(res.status, data, requestId);
      return data;
    }
    const get = (path, params, query) => send("GET", path, params, query, {});
    function write(method, path, params, body, options2, extra = {}) {
      if (key === void 0) throw new Error("munshi: this call needs the publishable key of the site");
      const idempotencyKey = options2.idempotencyKey ?? newIdempotencyKey();
      if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw new Error("munshi: an Idempotency-Key is 8–128 of A–Z a–z 0–9 _ -");
      const headers = { authorization: `Bearer ${key}`, "idempotency-key": idempotencyKey, ...extra };
      return send(method, path, params, void 0, headers, body);
    }
    return {
      site: (slug) => get("/sites/{slug}", { slug }),
      catalogue: (slug, query = {}) => get("/sites/{slug}/catalogue", { slug }, query),
      services: (slug, query = {}) => get("/sites/{slug}/services", { slug }, query),
      packages: (slug, query = {}) => get("/sites/{slug}/packages", { slug }, query),
      offers: (slug, query = {}) => get("/sites/{slug}/offers", { slug }, query),
      stylists: (slug, query = {}) => get("/sites/{slug}/stylists", { slug }, query),
      slots: (slug, query) => get("/sites/{slug}/slots", { slug }, query),
      // A ref that does not parse is answered here, without a request: it cannot trace to a cell.
      ref: async (slug, ref) => {
        const m = REF.exec(ref);
        if (!m) return { verified: false, label: CANNOT_VERIFY };
        return get("/sites/{slug}/refs/{snapshot}/{row}/{col}", { slug, snapshot: m[1], row: m[2], col: m[3] });
      },
      orderStatus: (slug, code) => get("/sites/{slug}/orders/{code}", { slug, code }),
      hold: (slug, body, options2 = {}) => write("POST", "/sites/{slug}/holds", { slug }, body, options2, { "x-munshi-device": device() }),
      releaseHold: (slug, holdId, holdToken, options2 = {}) => write("DELETE", "/sites/{slug}/holds/{id}", { slug, id: holdId }, void 0, options2, { "x-hold-token": holdToken }),
      book: (slug, body, options2 = {}) => write("POST", "/sites/{slug}/bookings", { slug }, body, options2),
      requestBooking: (slug, body, options2 = {}) => write("POST", "/sites/{slug}/booking-requests", { slug }, body, options2),
      enquire: (slug, body, options2 = {}) => write("POST", "/sites/{slug}/enquiries", { slug }, body, options2),
      reserve: (slug, body, options2 = {}) => write("POST", "/sites/{slug}/reservations", { slug }, body, options2),
      order: (slug, body, options2 = {}) => write("POST", "/sites/{slug}/orders", { slug }, body, options2)
    };
  }
  function toError(status, data, header) {
    const e = data?.error;
    const known = typeof e?.code === "string" && Object.hasOwn(CODES, e.code);
    const id = known && typeof e?.requestId === "string" ? e.requestId : header;
    const fields = known && Array.isArray(e?.fields) ? e.fields.filter((f) => typeof f === "string" && FIELD.test(f)) : [];
    return new MunshiError(status, known ? e?.code : "internal", id !== null && REQUEST_ID.test(id) ? id : null, fields);
  }

  // src/order.ts
  var MAX_PAGES = 10;
  var MAX_UNITS = 99;
  var UNIT = 1e3;
  var REFUSED = {
    intake_paused: "The shop is not taking orders right now.",
    rate_limited: "Too many tries from here. Wait a little and try again.",
    not_found: "Ordering is not available on this page.",
    invalid: "The shop could not take this cart. Check it and try again.",
    idempotency_mismatch: "The shop could not take this cart. Check it and try again."
  };
  var TRY_AGAIN = "Could not reach the shop. Try again: the same order is sent, never a second one.";
  var CSS = `
:host { display: block; font: 15px/1.45 system-ui, sans-serif; color: var(--ink, #1d1d1f); }
:host([hidden]) { display: none; }
section { background: var(--surface, #fff); border: 1px solid var(--hairline, #d9d9de); border-radius: var(--radius-card, 12px); padding: 16px; }
h2 { margin: 0 0 4px; font-size: 18px; }
.label { display: inline-block; font-size: 12px; padding: 2px 8px; border-radius: 999px; background: var(--warn, #f5e6b8); }
ul { list-style: none; padding: 0; margin: 12px 0; }
li { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; padding: 8px 0; border-top: 1px solid var(--hairline, #ececf0); }
.name { flex: 1 1 12em; }
.unit, .note { color: var(--ink-muted, #5f5f66); font-size: 13px; }
.figure { font-variant-numeric: tabular-nums; font-weight: 600; }
.src { font-size: 12px; background: none; border: 0; color: var(--accent, #1f5fbf); text-decoration: underline; cursor: pointer; padding: 0; }
.qty { display: inline-flex; gap: 6px; align-items: center; }
.qty button, .place { border: 1px solid var(--hairline, #c9c9cf); background: var(--surface, #fff); border-radius: var(--radius-chip, 8px); padding: 4px 10px; cursor: pointer; }
.place { background: var(--accent, #1f5fbf); color: var(--accent-ink, #fff); border: 0; padding: 8px 16px; }
.place[disabled], .qty button[disabled] { opacity: .5; cursor: default; }
.held { font-size: 12px; color: var(--signal, #a15c00); }
.panel { margin-top: 12px; padding: 12px; border-radius: var(--radius-card, 12px); background: var(--ground, #f6f6f8); }
.error { color: var(--danger, #b3261e); }
`;
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) el.setAttribute(k, v);
    for (const c of children) if (c !== null) el.append(c);
    return el;
  }
  var isMoney = (f) => "ref" in f;
  var TOKEN = /^--[a-z][a-z0-9-]{0,40}$/;
  var TOKEN_VALUE = /^[A-Za-z0-9 #.,%_-]{1,40}$/;
  var MunshiOrder = class extends HTMLElement {
    static observedAttributes = ["site", "key", "api", "shop", "status-page"];
    #root;
    #client = null;
    #slug = "";
    #site = null;
    #items = [];
    #cart = /* @__PURE__ */ new Map();
    // variant id → the customer's qtyMilli
    // One Idempotency-Key per attempt: a retry of the same cart reuses it, so the API replays the first answer rather than
    // storing a second request; a changed cart is a new attempt.
    #attempt = null;
    #sending = false;
    #loads = 0;
    #scheduled = false;
    #result = null;
    #message = null;
    #panel = null;
    constructor() {
      super();
      this.#root = this.attachShadow({ mode: "open" });
    }
    connectedCallback() {
      this.#schedule();
    }
    attributeChangedCallback() {
      if (this.isConnected) this.#schedule();
    }
    /** Resolves once the current load has rendered (tests and pages that wait for the widget). */
    ready = Promise.resolve();
    #schedule() {
      if (this.#scheduled) return;
      this.#scheduled = true;
      this.ready = new Promise(
        (resolve) => queueMicrotask(() => {
          this.#scheduled = false;
          void this.#load().finally(resolve);
        })
      );
    }
    // Nothing is shown: no frame, no text, no error (an off capability, an unknown site, a failed read alike).
    #nothing() {
      this.#root.replaceChildren();
      this.hidden = true;
    }
    async #load() {
      const run = ++this.#loads;
      const slug = this.getAttribute("site") ?? "";
      const api = this.getAttribute("api") ?? "";
      const key = this.getAttribute("key") ?? void 0;
      this.#site = null;
      this.#items = [];
      this.#cart.clear();
      this.#attempt = null;
      this.#result = null;
      this.#message = null;
      this.#nothing();
      if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug) || !/^https?:\/\//.test(api)) return;
      try {
        const client = createClient({ baseUrl: api, ...key ? { key } : {} });
        const site = await client.site(slug);
        if (!site.capabilities.includes("orders")) return;
        const items = [];
        let cursor;
        for (let page = 0; page < MAX_PAGES; page++) {
          const got = await client.catalogue(slug, cursor ? { cursor } : {});
          items.push(...got.data);
          if (!got.next) break;
          cursor = got.next;
        }
        if (run !== this.#loads) return;
        this.#client = client;
        this.#slug = slug;
        this.#site = site;
        this.#items = items;
        this.#theme(site);
        this.hidden = false;
        this.#render();
      } catch {
        if (run === this.#loads) this.#nothing();
      }
    }
    #theme(site) {
      const tokens = "light" in site.look.tokens ? site.look.tokens.light : site.look.tokens;
      for (const [name, value] of Object.entries(tokens)) if (TOKEN.test(name) && typeof value === "string" && TOKEN_VALUE.test(value)) this.style.setProperty(name, value);
    }
    #styles() {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        this.#root.adoptedStyleSheets = [sheet];
        return null;
      } catch {
        return h("style", {}, CSS);
      }
    }
    // ---- Figures ----
    /** A figure as the API gave it, with its ref; one that cannot be traced reads "Cannot verify" and has no ref. */
    #figure(f) {
      const shown = formatMoney(f);
      if (shown === CANNOT_VERIFY) return h("span", { class: "figure", "data-unverified": "" }, CANNOT_VERIFY);
      const refs = isMoney(f) ? [f.ref] : f.from;
      const value = h("span", { class: "figure", ...isMoney(f) ? { "data-ref": f.ref } : { "data-from": f.from.join(" ") } }, shown);
      const source = h("button", { type: "button", class: "src", "aria-label": "Where this figure comes from" }, "source");
      source.addEventListener("click", () => void this.#source(refs, !isMoney(f)));
      return h("span", { class: "fig" }, value, " ", source);
    }
    #cell(c) {
      if ("minor" in c) return h("span", { class: "figure", "data-ref": c.ref }, formatMoney(c));
      if ("value" in c) return h("span", { class: "figure", "data-ref": c.ref }, String(c.value));
      if ("text" in c) return h("span", { "data-ref": c.ref }, c.text);
      if ("date" in c) return h("span", { "data-ref": c.ref, "data-kind": "time" }, c.date);
      return h("span", { "data-ref": c.ref, "data-kind": "time" }, c.at);
    }
    // "Tap for source": each ref's published cell and the book row it came from, as the API answers it.
    async #source(refs, derived) {
      const client = this.#client;
      if (!client || !this.#panel) return;
      const panel = this.#panel;
      panel.hidden = false;
      panel.replaceChildren(h("p", {}, "Looking up the source…"));
      const rows = [];
      for (const ref of refs) {
        const answer = await client.ref(this.#slug, ref).catch(() => ({ verified: false, label: CANNOT_VERIFY }));
        rows.push(
          answer.verified ? h("li", {}, this.#cell(answer.cell), ` from ${answer.source.table}, row `, h("code", { "data-kind": "code" }, answer.source.id), ", as the shop published it") : h("li", { "data-ref": ref }, CANNOT_VERIFY)
        );
      }
      panel.replaceChildren(
        h("p", {}, derived ? "Worked out with the shop counter’s arithmetic from these published prices and your quantities:" : "This figure is the shop’s published cell:"),
        h("ul", {}, ...rows)
      );
    }
    // ---- The page ----
    #render() {
      const site = this.#site;
      if (!site) {
        this.#nothing();
        return;
      }
      const style = this.#styles();
      const paused = site.intake !== "open";
      const list = h("ul", { class: "items" });
      for (const item of this.#items) for (const v of item.variants) list.append(this.#row(item, v, paused));
      this.#panel = h("div", { class: "panel", role: "status", "aria-live": "polite" });
      this.#panel.hidden = true;
      const place = h("button", { type: "button", class: "place" }, this.#sending ? "Sending…" : "Send order to the shop");
      place.toggleAttribute("disabled", paused || this.#sending || this.#cart.size === 0 || !this.getAttribute("key"));
      place.addEventListener("click", () => void this.#place());
      this.#root.replaceChildren(
        ...style ? [style] : [],
        h(
          "section",
          { part: "widget" },
          h("header", {}, h("h2", {}, site.name), site.label ? h("span", { class: "label" }, site.label) : null),
          list,
          h(
            "div",
            { class: "cart" },
            paused ? h("p", { class: "note" }, REFUSED.intake_paused) : null,
            h("p", { class: "note" }, "Prices are as the shop published them. The shop works out and confirms your total."),
            place,
            this.#message ? h("p", { class: this.#message.error ? "error" : "note", role: "alert" }, this.#message.text) : null
          ),
          this.#result ? this.#answer(this.#result) : null,
          this.#panel
        )
      );
    }
    #row(item, v, paused) {
      const name = item.variants.length > 1 || v.name !== item.name ? `${item.name} · ${v.name}` : item.name;
      const qty = this.#cart.get(v.id) ?? 0;
      const less = h("button", { type: "button", "aria-label": `One less ${name}` }, "−");
      const more = h("button", { type: "button", "aria-label": `One more ${name}` }, "+");
      less.toggleAttribute("disabled", qty === 0 || this.#sending);
      more.toggleAttribute("disabled", v.held || paused || this.#sending || qty >= MAX_UNITS * UNIT);
      less.addEventListener("click", () => this.#change(v.id, -UNIT));
      more.addEventListener("click", () => this.#change(v.id, UNIT));
      return h(
        "li",
        { "data-item": v.id },
        // The shop's published item text (it may hold digits, as in "250 g"): a name, not a figure.
        h("span", { class: "name", "data-kind": "name" }, name),
        h("span", { class: "unit" }, `per ${v.unit}`),
        this.#figure(v.price),
        v.held ? h("span", { class: "held" }, "On hold for a customer") : null,
        // The customer's own quantity: the one number on the page that is theirs, not the shop's.
        h("span", { class: "qty" }, less, h("output", { "data-source": "request", "aria-label": "Your quantity" }, String(qty / UNIT)), more)
      );
    }
    #change(itemId, by) {
      const next = Math.min(MAX_UNITS * UNIT, Math.max(0, (this.#cart.get(itemId) ?? 0) + by));
      if (next === 0) this.#cart.delete(itemId);
      else this.#cart.set(itemId, next);
      this.#message = null;
      this.#render();
    }
    // ---- Sending the order ----
    async #place() {
      const client = this.#client;
      const site = this.#site;
      if (!client || !site || this.#sending || this.#cart.size === 0) return;
      const shopId = this.getAttribute("shop") ?? site.shops[0]?.id;
      if (!shopId) return;
      const body = { shopId, channel: "widget", lines: [...this.#cart].map(([itemId, qtyMilli]) => ({ itemId, qtyMilli })) };
      const text = JSON.stringify(body);
      if (!this.#attempt || this.#attempt.body !== text) this.#attempt = { key: newIdempotencyKey(), body: text };
      const attempt = this.#attempt;
      this.#sending = true;
      this.#message = null;
      this.#render();
      try {
        this.#result = await client.order(this.#slug, body, { idempotencyKey: attempt.key });
        this.#attempt = null;
        this.#cart.clear();
        this.#message = { text: "Sent. The shop will confirm your order.", error: false };
      } catch (err) {
        const code = err instanceof MunshiError ? err.code : null;
        const final = code !== null && code !== "internal" && code !== "rate_limited";
        if (final) this.#attempt = null;
        this.#message = { text: code && REFUSED[code] || TRY_AGAIN, error: true };
      } finally {
        this.#sending = false;
        this.#render();
      }
    }
    #answer(o) {
      const names = new Map(this.#items.flatMap((i) => i.variants.map((v) => [v.id, i.variants.length > 1 || v.name !== i.name ? `${i.name} · ${v.name}` : i.name])));
      const units = new Map(this.#items.flatMap((i) => i.variants.map((v) => [v.id, v.unit])));
      const status = this.getAttribute("status-page");
      const api = (this.getAttribute("api") ?? "").replace(/\/+$/, "");
      const code = encodeURIComponent(o.code);
      const href = status?.includes("{code}") && /^https?:\/\//.test(status) ? status.replace("{code}", code) : `${api}/api/v1/sites/${this.#slug}/orders/${code}`;
      const lines = o.lines.map(
        (l) => h(
          "li",
          {},
          h("span", { class: "name", "data-kind": "name" }, names.get(l.itemId) ?? "Item"),
          h("output", { "data-source": "request" }, String(l.qty.qtyMilli / UNIT)),
          ` ${units.get(l.itemId) ?? "piece"} at `,
          this.#figure(l.price),
          " = ",
          this.#figure(l.amount)
        )
      );
      return h(
        "div",
        { class: "answer" },
        h("p", {}, "Your order code: ", h("strong", { "data-kind": "code" }, o.code)),
        h("ul", {}, ...lines),
        h("p", {}, "Total at today’s prices: ", this.#figure(o.total)),
        o.offerCode ? h("p", { class: "note" }, "Offer code ", h("span", { "data-kind": "code" }, o.offerCode), ": to be checked at the shop") : null,
        h("p", {}, h("a", { href, target: "_blank", rel: "noopener" }, "Order status"), o.waLink ? " · " : null, o.waLink ? h("a", { href: o.waLink, target: "_blank", rel: "noopener" }, "Send on WhatsApp") : null)
      );
    }
  };

  // src/index.ts
  if (typeof customElements !== "undefined" && !customElements.get("munshi-order")) customElements.define("munshi-order", MunshiOrder);
})();
