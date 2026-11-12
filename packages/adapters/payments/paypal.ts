// PayPal (sandbox): a payment link for an amount the shop is owed, its status, and PayPal's webhook signature. Munshi
// never moves money: PayPal holds and moves it; this adapter only asks PayPal for an invoice the customer pays on
// PayPal's own page, reads it back, and asks PayPal whether a notification is its own. Endpoints are PayPal's public
// REST docs (developer.paypal.com/api/rest, /api/invoicing/v2, /api/webhooks/v1), base https://api-m.sandbox.paypal.com:
//   POST /v1/oauth2/token                              client credentials (HTTP Basic client id:secret), cached to expiry
//   POST /v2/invoicing/search-invoices                 our own invoice number first, so a retry never makes a second one
//   POST /v2/invoicing/invoices                        a draft invoice (detail.invoice_number, reference, one item)
//   POST /v2/invoicing/invoices/{invoice_id}/send      send_to_recipient false: PayPal answers the payer-view link
//   GET  /v2/invoicing/invoices/{invoice_id}           status and payments.paid_amount
//   POST /v2/invoicing/invoices/{invoice_id}/cancel    close a link whose debt was settled another way (204)
//   POST /v1/notifications/verify-webhook-signature    PayPal checks a notification against our webhook id
// Idempotency: every write carries PayPal-Request-Id (the caller's request id: the draft's id). The invoicing schema
// does not list that header for create, so the invoice number, derived from the same id, is the documented guard:
// search first, create only when PayPal holds none.
// Recorded mode (the default, and every test) holds no credentials and never calls fetch: ids are derived from the
// request id, nothing is ever paid, and no notification verifies.
// Errors carry a code only, built fresh: no secret, token, header or body can reach a message, a stack or a log line.
// Every call carries an AbortSignal timeout (timeoutMs, ten seconds by default): no caller waits on PayPal for longer.
import { createHash } from 'node:crypto';

type Fetch = typeof globalThis.fetch;

export const PAYPAL_SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';
export const PAYPAL_SANDBOX_LABEL = 'PayPal sandbox';

export type PayPalMode = 'sandbox' | 'recorded';
export type LinkRequest = { requestId: string; amountMinor: number; currency: string; reference: string };
export type Link = { paypalId: string; status: string; payerUrl: string | null; mode: PayPalMode };
export type InvoiceState = { paypalId: string; status: string; paidMinor: number | null; currency: string | null };
// PayPal's five transmission headers, as received (lower-case names).
export type WebhookHeaders = Record<'paypal-transmission-id' | 'paypal-transmission-time' | 'paypal-transmission-sig' | 'paypal-cert-url' | 'paypal-auth-algo', string | null>;

/**
 * A sandbox account takes only some currencies (a US test merchant refuses INR). Where the shop's currency is one it
 * refuses, the test invoice asks for the same digits in the account's currency, and what PayPal answers in that
 * currency is read back as the shop's: the books and every check stay in the shop's currency. Sandbox only.
 */
export type CurrencyMap = { shop: string; paypal: string };

export interface PayPal {
  readonly mode: PayPalMode;
  readonly label: string;
  /** Set only on a sandbox test account that cannot invoice in the shop's currency. */
  readonly currencyMap?: CurrencyMap;
  createLink(r: LinkRequest): Promise<Link>;
  invoice(paypalId: string): Promise<InvoiceState>;
  cancel(paypalId: string, requestId: string): Promise<void>;
  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders): Promise<boolean>;
}

export type PayPalErrorCode = 'paypal_auth' | 'paypal_http' | 'paypal_network' | 'paypal_response' | 'paypal_input';
export class PayPalError extends Error {
  readonly code: PayPalErrorCode;
  readonly status: number | null;
  constructor(code: PayPalErrorCode, status: number | null = null) {
    super(`paypal: ${code}${status === null ? '' : ` ${status}`}`);
    this.name = 'PayPalError';
    this.code = code;
    this.status = status;
  }
}

// ---- money: minor units to PayPal's decimal strings and back, by digits alone -----------------------------------------
// PayPal's zero-decimal currencies (developer.paypal.com/api/rest/reference/currency-codes): refused here, never guessed.
const ZERO_DECIMAL = new Set(['JPY', 'HUF', 'TWD']);

export function paypalValue(amountMinor: number, currency: string): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !/^[A-Z]{3}$/.test(currency) || ZERO_DECIMAL.has(currency)) throw new PayPalError('paypal_input');
  return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, '0')}`;
}

export function minorOf(value: unknown): number | null {
  const m = typeof value === 'string' ? /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value) : null;
  return m ? Number(m[1]) * 100 + Number(`${m[2] ?? ''}00`.slice(0, 2)) : null;
}

// Our invoice number for a request: at most 25 characters (invoice_detail.invoice_number), the same for every retry.
export const invoiceNumber = (requestId: string) => `MS-${requestId.replace(/-/g, '').slice(0, 20).toUpperCase()}`;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max = 128): string | null => (typeof v === 'string' && v.length >= 1 && v.length <= max ? v : null);
export const PAYPAL_ID = /^[A-Za-z0-9-]{1,64}$/;
const REFERENCE = /^[A-Za-z0-9-]{1,64}$/;

// ---- webhook ----------------------------------------------------------------------------------------------------------
// Verified by PayPal itself (verify-webhook-signature, with our PAYPAL_WEBHOOK_ID): this side never fetches the
// certificate URL a request names (the sender chooses it; a forged one would make us fetch anywhere). A transmission
// outside the window is refused before PayPal is asked, so a captured notification cannot be replayed later; the caller
// also refuses an event id it already stored.
export const WEBHOOK_WINDOW_MS = 10 * 60_000;

/** A certificate URL on PayPal's own hosts over https (never fetched here: PayPal's verify call is given it). */
export function paypalCertUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.port && /^(api|api-m)(\.sandbox)?\.paypal\.com$/.test(u.hostname) && u.pathname.startsWith('/v1/notifications/certs/');
  } catch {
    return false;
  }
}

/** The five headers present and well formed (SHA256withRSA, a certificate on PayPal's hosts), and the transmission time
 * within the window of `now`. Checked before PayPal is asked anything. */
export function webhookHeadersOk(h: WebhookHeaders, now: number): boolean {
  const id = h['paypal-transmission-id'];
  const time = h['paypal-transmission-time'];
  const sig = h['paypal-transmission-sig'];
  const cert = h['paypal-cert-url'];
  const algo = h['paypal-auth-algo'];
  if (!id || !time || !sig || !cert || !algo) return false;
  if (id.length > 50 || time.length > 100 || sig.length > 500 || algo !== 'SHA256withRSA' || !paypalCertUrl(cert)) return false;
  const at = Date.parse(time);
  return Number.isFinite(at) && Math.abs(now - at) <= WEBHOOK_WINDOW_MS;
}

export type PaidEvent = { eventId: string; paypalId: string; status: string; paidMinor: number | null; currency: string | null };

/**
 * An INVOICING.INVOICE.PAID notification's ids and paid amount; null for any other event or a malformed one. PayPal
 * sends this event for a full, a partial or a pending payment, so the invoice's own status is kept: only PAID is paid.
 * The resource is read as `resource.invoice` or, failing that, `resource` itself (UNVERIFIED which one the v2 event
 * carries; both are tried, and an id that is not PayPal's shape is refused).
 */
export function parsePaidEvent(payload: unknown): PaidEvent | null {
  const e = obj(payload);
  const eventId = str(e.id, 64);
  if (e.event_type !== 'INVOICING.INVOICE.PAID' || !eventId || !PAYPAL_ID.test(eventId)) return null;
  const r = obj(e.resource);
  const inv = Object.keys(obj(r.invoice)).length ? obj(r.invoice) : r;
  const paypalId = str(inv.id, 64);
  const status = str(inv.status, 32);
  if (!paypalId || !PAYPAL_ID.test(paypalId) || !status) return null;
  const paid = obj(obj(inv.payments).paid_amount);
  const currency = str(paid.currency_code, 3);
  return { eventId, paypalId, status, paidMinor: minorOf(paid.value), currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null };
}

const invoiceState = (paypalId: string, body: unknown): InvoiceState => {
  const b = obj(body);
  const paid = obj(obj(b.payments).paid_amount);
  const currency = str(paid.currency_code, 3);
  return { paypalId, status: str(b.status, 32) ?? 'UNKNOWN', paidMinor: minorOf(paid.value), currency };
};

// ---- the sandbox adapter ----------------------------------------------------------------------------------------------
export type SandboxConfig = { clientId: string; clientSecret: string; webhookId: string; currencyMap?: CurrencyMap; fetch?: Fetch; now?: () => number; timeoutMs?: number };

export function paypalSandbox(cfg: SandboxConfig): PayPal {
  const doFetch: Fetch = cfg.fetch ?? ((...a) => globalThis.fetch(...a));
  const now = cfg.now ?? Date.now;
  const timeoutMs = cfg.timeoutMs ?? 10_000;
  let token: { value: string; until: number } | null = null;

  async function call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new PayPalError('paypal_network');
    }
  }

  async function bearer(): Promise<string> {
    if (token && token.until > now()) return token.value;
    const res = await call(`${PAYPAL_SANDBOX_BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`, 'utf8').toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new PayPalError('paypal_auth', res.status);
    const b = obj(await res.json().catch(() => null));
    const value = str(b.access_token, 4096);
    const seconds = typeof b.expires_in === 'number' && b.expires_in > 0 ? b.expires_in : 0;
    if (!value) throw new PayPalError('paypal_response');
    // Kept a minute short of PayPal's expiry, so a token is never used as it lapses.
    token = { value, until: now() + Math.max(0, seconds - 60) * 1000 };
    return value;
  }

  async function api(method: 'GET' | 'POST', path: string, body?: unknown, requestId?: string): Promise<unknown> {
    const res = await call(`${PAYPAL_SANDBOX_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await bearer()}`,
        'content-type': 'application/json',
        prefer: 'return=representation',
        ...(requestId ? { 'paypal-request-id': requestId } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 401) token = null;
    if (!res.ok) throw new PayPalError('paypal_http', res.status);
    return res.status === 204 ? {} : res.json().catch(() => ({}));
  }

  const viewUrl = (inv: Record<string, unknown>) => str(obj(obj(inv.detail).metadata).recipient_view_url, 490);

  const map = cfg.currencyMap;
  const toPaypal = (currency: string) => (map && currency === map.shop ? map.paypal : currency);
  const fromPaypal = (s: InvoiceState): InvoiceState => (map && s.currency === map.paypal ? { ...s, currency: map.shop } : s);

  return {
    mode: 'sandbox',
    label: PAYPAL_SANDBOX_LABEL,
    ...(map ? { currencyMap: map } : {}),
    async createLink(r) {
      const currency = toPaypal(r.currency);
      const value = paypalValue(r.amountMinor, currency);
      if (!REFERENCE.test(r.reference) || !REFERENCE.test(r.requestId)) throw new PayPalError('paypal_input');
      const number = invoiceNumber(r.requestId);
      const found = obj(await api('POST', '/v2/invoicing/search-invoices?page=1&page_size=1', { invoice_number: number }));
      let inv = obj((Array.isArray(found.items) ? found.items : [])[0]);
      if (!str(inv.id)) {
        inv = obj(
          await api(
            'POST',
            '/v2/invoicing/invoices',
            {
              detail: {
                invoice_number: number,
                reference: r.reference,
                currency_code: currency,
                note: currency === r.currency ? 'Recorded by Munshi; payable on PayPal.' : `Sandbox test: the shop's ${r.currency} amount, shown in ${currency}.`,
              },
              items: [{ name: 'Balance due', quantity: '1', unit_amount: { currency_code: currency, value } }],
            },
            r.requestId,
          ),
        );
      }
      const paypalId = str(inv.id, 64);
      if (!paypalId || !PAYPAL_ID.test(paypalId)) throw new PayPalError('paypal_response');
      const status = str(inv.status, 32) ?? 'DRAFT';
      if (status !== 'DRAFT') return { paypalId, status, payerUrl: viewUrl(inv), mode: 'sandbox' };
      const sent = obj(await api('POST', `/v2/invoicing/invoices/${encodeURIComponent(paypalId)}/send`, { send_to_recipient: false, send_to_invoicer: false }, `${r.requestId}-send`));
      return { paypalId, status: 'SENT', payerUrl: str(sent.href, 490), mode: 'sandbox' };
    },
    async invoice(paypalId) {
      if (!PAYPAL_ID.test(paypalId)) throw new PayPalError('paypal_input');
      return fromPaypal(invoiceState(paypalId, await api('GET', `/v2/invoicing/invoices/${encodeURIComponent(paypalId)}`)));
    },
    async cancel(paypalId, requestId) {
      if (!PAYPAL_ID.test(paypalId) || !REFERENCE.test(requestId)) throw new PayPalError('paypal_input');
      const path = `/v2/invoicing/invoices/${encodeURIComponent(paypalId)}`;
      try {
        await api('POST', `${path}/cancel`, { send_to_recipient: false, send_to_invoicer: false }, requestId);
      } catch (err) {
        // A retry after PayPal already cancelled it: 422, and the invoice reads CANCELLED. Anything else is an error.
        if (!(err instanceof PayPalError && err.status === 422) || invoiceState(paypalId, await api('GET', path)).status !== 'CANCELLED') throw err;
      }
    },
    async verifyWebhook(rawBody, h) {
      if (!cfg.webhookId || !webhookHeadersOk(h, now())) return false;
      let event: unknown;
      try {
        event = JSON.parse(rawBody.toString('utf8'));
      } catch {
        return false;
      }
      try {
        const answer = obj(
          await api('POST', '/v1/notifications/verify-webhook-signature', {
            auth_algo: h['paypal-auth-algo'],
            cert_url: h['paypal-cert-url'],
            transmission_id: h['paypal-transmission-id'],
            transmission_sig: h['paypal-transmission-sig'],
            transmission_time: h['paypal-transmission-time'],
            webhook_id: cfg.webhookId,
            webhook_event: event,
          }),
        );
        return answer.verification_status === 'SUCCESS';
      } catch {
        return false;
      }
    },
  };
}

// ---- recorded mode ----------------------------------------------------------------------------------------------------
/**
 * No network and no credentials: a request's link is derived from its request id (the same id gives the same link, so a
 * retry makes nothing twice), it is never paid, it has no payer page, and no notification verifies.
 */
export function recordedPayPal(): PayPal {
  return {
    mode: 'recorded',
    label: `${PAYPAL_SANDBOX_LABEL} (recorded)`,
    async createLink(r) {
      paypalValue(r.amountMinor, r.currency);
      if (!REFERENCE.test(r.reference) || !REFERENCE.test(r.requestId)) throw new PayPalError('paypal_input');
      const paypalId = `REC-${createHash('sha256').update(r.requestId).digest('hex').slice(0, 20).toUpperCase()}`;
      return { paypalId, status: 'SENT', payerUrl: null, mode: 'recorded' };
    },
    async invoice(paypalId) {
      if (!PAYPAL_ID.test(paypalId)) throw new PayPalError('paypal_input');
      return { paypalId, status: 'SENT', paidMinor: null, currency: null };
    },
    async cancel(paypalId, requestId) {
      if (!PAYPAL_ID.test(paypalId) || !REFERENCE.test(requestId)) throw new PayPalError('paypal_input');
    },
    async verifyWebhook() {
      return false;
    },
  };
}
