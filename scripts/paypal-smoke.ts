// One live round trip against PayPal's sandbox through Munshi's own adapter: a payment link (an invoice PayPal holds)
// in each currency asked for, read back, then cancelled so nothing is left open. Prints ids, states and PayPal's
// error codes only: never a key, a token or a response body.
// Run: node scripts/paypal-smoke.ts [INR USD ...]   (exit 1 when any currency fails)
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadEnvFiles, paypalSettings } from '../packages/config/src/index.ts';
import { PayPalError, paypalSandbox } from '../packages/adapters/payments/paypal.ts';

loadEnvFiles([fileURLToPath(new URL('../.env', import.meta.url))]);
const settings = paypalSettings({ ...process.env, PAYPAL_SANDBOX_CURRENCY: process.env.PAYPAL_SANDBOX_CURRENCY || "INR:USD" });
if (settings.mode !== 'sandbox') {
  console.error('PayPal is in recorded mode: set PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_WEBHOOK_ID.');
  process.exit(1);
}
const paypal = paypalSandbox({ clientId: settings.clientId, clientSecret: settings.clientSecret, webhookId: settings.webhookId, ...(settings.currencyMap ? { currencyMap: settings.currencyMap } : {}), timeoutMs: 20_000 });

const currencies = process.argv.slice(2).length ? process.argv.slice(2) : ['INR', 'USD'];
let failed = 0;
for (const currency of currencies) {
  const requestId = randomUUID();
  try {
    const link = await paypal.createLink({ requestId, amountMinor: 12_345, currency, reference: `smoke-${requestId}`.slice(0, 64) });
    console.log(`${currency}: created ${link.paypalId} (${link.status}), payer link ${link.payerUrl ? 'returned' : 'missing'}`);
    const state = await paypal.invoice(link.paypalId);
    console.log(`${currency}: read back ${state.status}, ${state.currency ?? 'no currency'}`);
    await paypal.cancel(link.paypalId, `${requestId}-cancel`);
    console.log(`${currency}: cancelled`);
  } catch (error) {
    failed += 1;
    console.log(`${currency}: FAILED ${error instanceof PayPalError ? `${error.code}${error.status === null ? '' : ` ${error.status}`}` : 'unexpected error'}`);
  }
}
process.exit(failed ? 1 : 0);
