// <munshi-order>: a shop's published catalogue and a cart, on any page (platform spec §4, BLUEPRINT §5.6). It reads the
// site and its catalogue with the SDK, and sends the cart as `POST /sites/{slug}/orders` with the publishable key.
//
//   <munshi-order site="prabhave" key="mpk_prabhave_…" api="https://munshi.example"></munshi-order>
//   optional: shop="<branch id>" (else the site's first branch), status-page="https://shop.example/orders/{code}"
//
// Guarantee clause 2 on the page: every figure shown is a cell the API returned, rendered with its ref (`data-ref`, or
// `data-from` for the cart's derived figures) and a "source" button that asks the API for the cell's book row; one that
// cannot be traced reads "Cannot verify". The widget computes no figure: before the order it shows each price cell and
// the customer's own quantity, and the line amounts and the total appear only as the API's answer gives them.
// A capability the release has off (`orders` not in site.capabilities), an unknown or unverified site, or a failed read
// renders nothing. The order is the shop's to confirm: nothing here writes the books (the API stores an ops request).
import {
  CANNOT_VERIFY,
  type CatalogueItem,
  type Client,
  createClient,
  type DerivedMoney,
  formatMoney,
  MunshiError,
  type MoneyFigure,
  newIdempotencyKey,
  type OrderBody,
  type OrderCreated,
  type PublishedCell,
  type Site,
} from '@munshi/sdk';

const MAX_PAGES = 10;
const MAX_UNITS = 99;
const UNIT = 1000; // qtyMilli of one whole unit: the widget orders whole units only

// Fixed copy per API code; a server's own text never reaches the page.
const REFUSED: Record<string, string> = {
  intake_paused: 'The shop is not taking orders right now.',
  rate_limited: 'Too many tries from here. Wait a little and try again.',
  not_found: 'Ordering is not available on this page.',
  invalid: 'The shop could not take this cart. Check it and try again.',
  idempotency_mismatch: 'The shop could not take this cart. Check it and try again.',
};
const TRY_AGAIN = 'Could not reach the shop. Try again: the same order is sent, never a second one.';

const CSS = `
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

type Fig = MoneyFigure | DerivedMoney;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) el.setAttribute(k, v);
  for (const c of children) if (c !== null) el.append(c);
  return el;
}

const isMoney = (f: Fig): f is MoneyFigure => 'ref' in f;

// A look token as a CSS custom property, only in the contract's own grammar (no url(), no quote, no semicolon).
const TOKEN = /^--[a-z][a-z0-9-]{0,40}$/;
const TOKEN_VALUE = /^[A-Za-z0-9 #.,%_-]{1,40}$/;

export class MunshiOrder extends HTMLElement {
  static observedAttributes = ['site', 'key', 'api', 'shop', 'status-page'];

  readonly #root: ShadowRoot;
  #client: Client | null = null;
  #slug = '';
  #site: Site | null = null;
  #items: CatalogueItem[] = [];
  #cart = new Map<string, number>(); // variant id → the customer's qtyMilli
  // One Idempotency-Key per attempt: a retry of the same cart reuses it, so the API replays the first answer rather than
  // storing a second request; a changed cart is a new attempt.
  #attempt: { key: string; body: string } | null = null;
  #sending = false;
  #loads = 0;
  #scheduled = false;
  #result: OrderCreated | null = null;
  #message: { text: string; error: boolean } | null = null;
  #panel: HTMLElement | null = null;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.#schedule();
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.#schedule();
  }

  /** Resolves once the current load has rendered (tests and pages that wait for the widget). */
  ready: Promise<void> = Promise.resolve();

  #schedule(): void {
    if (this.#scheduled) return;
    this.#scheduled = true;
    this.ready = new Promise((resolve) =>
      queueMicrotask(() => {
        this.#scheduled = false;
        void this.#load().finally(resolve);
      }),
    );
  }

  // Nothing is shown: no frame, no text, no error (an off capability, an unknown site, a failed read alike).
  #nothing(): void {
    this.#root.replaceChildren();
    this.hidden = true;
  }

  async #load(): Promise<void> {
    const run = ++this.#loads;
    const slug = this.getAttribute('site') ?? '';
    const api = this.getAttribute('api') ?? '';
    const key = this.getAttribute('key') ?? undefined;
    this.#site = null;
    this.#items = [];
    this.#cart.clear();
    this.#attempt = null;
    this.#result = null;
    this.#message = null;
    this.#nothing();
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug) || !/^https?:\/\//.test(api)) return;
    try {
      const client = createClient({ baseUrl: api, ...(key ? { key } : {}) });
      const site = await client.site(slug);
      if (!site.capabilities.includes('orders')) return;
      const items: CatalogueItem[] = [];
      let cursor: string | undefined;
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

  #theme(site: Site): void {
    const tokens = 'light' in site.look.tokens ? site.look.tokens.light : site.look.tokens;
    for (const [name, value] of Object.entries(tokens)) if (TOKEN.test(name) && typeof value === 'string' && TOKEN_VALUE.test(value)) this.style.setProperty(name, value);
  }

  #styles(): Node | null {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      this.#root.adoptedStyleSheets = [sheet];
      return null;
    } catch {
      return h('style', {}, CSS);
    }
  }

  // ---- Figures ----

  /** A figure as the API gave it, with its ref; one that cannot be traced reads "Cannot verify" and has no ref. */
  #figure(f: Fig): HTMLElement {
    const shown = formatMoney(f);
    if (shown === CANNOT_VERIFY) return h('span', { class: 'figure', 'data-unverified': '' }, CANNOT_VERIFY);
    const refs = isMoney(f) ? [f.ref] : f.from;
    const value = h('span', { class: 'figure', ...(isMoney(f) ? { 'data-ref': f.ref } : { 'data-from': f.from.join(' ') }) }, shown);
    const source = h('button', { type: 'button', class: 'src', 'aria-label': 'Where this figure comes from' }, 'source');
    source.addEventListener('click', () => void this.#source(refs, !isMoney(f)));
    return h('span', { class: 'fig' }, value, ' ', source);
  }

  #cell(c: PublishedCell): HTMLElement {
    if ('minor' in c) return h('span', { class: 'figure', 'data-ref': c.ref }, formatMoney(c));
    if ('value' in c) return h('span', { class: 'figure', 'data-ref': c.ref }, String(c.value));
    if ('text' in c) return h('span', { 'data-ref': c.ref }, c.text);
    if ('date' in c) return h('span', { 'data-ref': c.ref, 'data-kind': 'time' }, c.date);
    return h('span', { 'data-ref': c.ref, 'data-kind': 'time' }, c.at);
  }

  // "Tap for source": each ref's published cell and the book row it came from, as the API answers it.
  async #source(refs: string[], derived: boolean): Promise<void> {
    const client = this.#client;
    if (!client || !this.#panel) return;
    const panel = this.#panel;
    panel.hidden = false;
    panel.replaceChildren(h('p', {}, 'Looking up the source…'));
    const rows: HTMLElement[] = [];
    for (const ref of refs) {
      const answer = await client.ref(this.#slug, ref).catch(() => ({ verified: false as const, label: CANNOT_VERIFY }));
      rows.push(
        answer.verified
          ? h('li', {}, this.#cell(answer.cell), ` from ${answer.source.table}, row `, h('code', { 'data-kind': 'code' }, answer.source.id), ', as the shop published it')
          : h('li', { 'data-ref': ref }, CANNOT_VERIFY),
      );
    }
    panel.replaceChildren(
      h('p', {}, derived ? 'Worked out with the shop counter’s arithmetic from these published prices and your quantities:' : 'This figure is the shop’s published cell:'),
      h('ul', {}, ...rows),
    );
  }

  // ---- The page ----

  #render(): void {
    const site = this.#site;
    if (!site) {
      this.#nothing();
      return;
    }
    const style = this.#styles();
    const paused = site.intake !== 'open';
    const list = h('ul', { class: 'items' });
    for (const item of this.#items) for (const v of item.variants) list.append(this.#row(item, v, paused));
    this.#panel = h('div', { class: 'panel', role: 'status', 'aria-live': 'polite' });
    this.#panel.hidden = true;

    const place = h('button', { type: 'button', class: 'place' }, this.#sending ? 'Sending…' : 'Send order to the shop');
    place.toggleAttribute('disabled', paused || this.#sending || this.#cart.size === 0 || !this.getAttribute('key'));
    place.addEventListener('click', () => void this.#place());

    this.#root.replaceChildren(
      ...(style ? [style] : []),
      h(
        'section',
        { part: 'widget' },
        h('header', {}, h('h2', {}, site.name), site.label ? h('span', { class: 'label' }, site.label) : null),
        list,
        h(
          'div',
          { class: 'cart' },
          paused ? h('p', { class: 'note' }, REFUSED.intake_paused as string) : null,
          h('p', { class: 'note' }, 'Prices are as the shop published them. The shop works out and confirms your total.'),
          place,
          this.#message ? h('p', { class: this.#message.error ? 'error' : 'note', role: 'alert' }, this.#message.text) : null,
        ),
        this.#result ? this.#answer(this.#result) : null,
        this.#panel,
      ),
    );
  }

  #row(item: CatalogueItem, v: CatalogueItem['variants'][number], paused: boolean): HTMLElement {
    const name = item.variants.length > 1 || v.name !== item.name ? `${item.name} · ${v.name}` : item.name;
    const qty = this.#cart.get(v.id) ?? 0;
    const less = h('button', { type: 'button', 'aria-label': `One less ${name}` }, '−');
    const more = h('button', { type: 'button', 'aria-label': `One more ${name}` }, '+');
    less.toggleAttribute('disabled', qty === 0 || this.#sending);
    more.toggleAttribute('disabled', v.held || paused || this.#sending || qty >= MAX_UNITS * UNIT);
    less.addEventListener('click', () => this.#change(v.id, -UNIT));
    more.addEventListener('click', () => this.#change(v.id, UNIT));
    return h(
      'li',
      { 'data-item': v.id },
      // The shop's published item text (it may hold digits, as in "250 g"): a name, not a figure.
      h('span', { class: 'name', 'data-kind': 'name' }, name),
      h('span', { class: 'unit' }, `per ${v.unit}`),
      this.#figure(v.price),
      v.held ? h('span', { class: 'held' }, 'On hold for a customer') : null,
      // The customer's own quantity: the one number on the page that is theirs, not the shop's.
      h('span', { class: 'qty' }, less, h('output', { 'data-source': 'request', 'aria-label': 'Your quantity' }, String(qty / UNIT)), more),
    );
  }

  #change(itemId: string, by: number): void {
    const next = Math.min(MAX_UNITS * UNIT, Math.max(0, (this.#cart.get(itemId) ?? 0) + by));
    if (next === 0) this.#cart.delete(itemId);
    else this.#cart.set(itemId, next);
    this.#message = null;
    this.#render();
  }

  // ---- Sending the order ----

  async #place(): Promise<void> {
    const client = this.#client;
    const site = this.#site;
    if (!client || !site || this.#sending || this.#cart.size === 0) return;
    const shopId = this.getAttribute('shop') ?? site.shops[0]?.id;
    if (!shopId) return;
    const body: OrderBody = { shopId, channel: 'widget', lines: [...this.#cart].map(([itemId, qtyMilli]) => ({ itemId, qtyMilli })) };
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
      this.#message = { text: 'Sent. The shop will confirm your order.', error: false };
    } catch (err) {
      // A refusal is final for this cart (a retry would be refused again); a lost answer or a server fault may be retried,
      // under the same key.
      const code = err instanceof MunshiError ? err.code : null;
      const final = code !== null && code !== 'internal' && code !== 'rate_limited';
      if (final) this.#attempt = null;
      this.#message = { text: (code && REFUSED[code]) || TRY_AGAIN, error: true };
    } finally {
      this.#sending = false;
      this.#render();
    }
  }

  #answer(o: OrderCreated): HTMLElement {
    const names = new Map(this.#items.flatMap((i) => i.variants.map((v) => [v.id, i.variants.length > 1 || v.name !== i.name ? `${i.name} · ${v.name}` : i.name] as const)));
    const units = new Map(this.#items.flatMap((i) => i.variants.map((v) => [v.id, v.unit] as const)));
    const status = this.getAttribute('status-page');
    const api = (this.getAttribute('api') ?? '').replace(/\/+$/, '');
    const code = encodeURIComponent(o.code);
    const href = status?.includes('{code}') && /^https?:\/\//.test(status) ? status.replace('{code}', code) : `${api}/api/v1/sites/${this.#slug}/orders/${code}`;
    const lines = o.lines.map((l) =>
      h(
        'li',
        {},
        h('span', { class: 'name', 'data-kind': 'name' }, names.get(l.itemId) ?? 'Item'),
        h('output', { 'data-source': 'request' }, String(l.qty.qtyMilli / UNIT)),
        ` ${units.get(l.itemId) ?? 'piece'} at `,
        this.#figure(l.price),
        ' = ',
        this.#figure(l.amount),
      ),
    );
    return h(
      'div',
      { class: 'answer' },
      h('p', {}, 'Your order code: ', h('strong', { 'data-kind': 'code' }, o.code)),
      h('ul', {}, ...lines),
      h('p', {}, 'Total at today’s prices: ', this.#figure(o.total)),
      o.offerCode ? h('p', { class: 'note' }, 'Offer code ', h('span', { 'data-kind': 'code' }, o.offerCode), ': to be checked at the shop') : null,
      h('p', {}, h('a', { href, target: '_blank', rel: 'noopener' }, 'Order status'), o.waLink ? ' · ' : null, o.waLink ? h('a', { href: o.waLink, target: '_blank', rel: 'noopener' }, 'Send on WhatsApp') : null),
    );
  }
}
