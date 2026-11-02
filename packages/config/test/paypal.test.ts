// PayPal's settings (paypalSettings): none is recorded mode, all three is the sandbox, anything between is refused by
// name; PAYPAL_ENV admits only `sandbox`; no value reaches an error.
import { inspect } from 'node:util';
import { expect, it } from 'vitest';
import { ConfigError, paypalSettings } from '../src/index.ts';

const SECRET = 'EBWKjlELKMYqRNQ6sYvFo64FtaRLRR5BdHEESmha49TM-secret';
const keys = { PAYPAL_CLIENT_ID: 'AcLientId0123456789', PAYPAL_CLIENT_SECRET: SECRET, PAYPAL_WEBHOOK_ID: '0NH55953DH663215D' };

it('PAYPAL-CFG1 none set is recorded mode; all three is the sandbox; a partial set or a live PAYPAL_ENV is refused, naming settings only', () => {
  expect(paypalSettings({})).toEqual({ mode: 'recorded' });
  expect(paypalSettings({ PAYPAL_ENV: 'sandbox' })).toEqual({ mode: 'recorded' });
  expect(paypalSettings({ ...keys, PAYPAL_ENV: 'sandbox' })).toEqual({ mode: 'sandbox', clientId: keys.PAYPAL_CLIENT_ID, clientSecret: SECRET, webhookId: keys.PAYPAL_WEBHOOK_ID });
  const refused = (env: Record<string, string>) => {
    try {
      paypalSettings(env);
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect(`${(e as Error).message} ${(e as Error).stack} ${inspect(e)}`).not.toContain(SECRET);
      return (e as ConfigError).names;
    }
    return null;
  };
  expect(refused({ PAYPAL_CLIENT_SECRET: SECRET })).toEqual(['PAYPAL_CLIENT_ID', 'PAYPAL_WEBHOOK_ID']);
  expect(refused({ ...keys, PAYPAL_ENV: 'live' })).toEqual(['PAYPAL_ENV']);
  expect(refused({ ...keys, PAYPAL_WEBHOOK_ID: 'not a webhook id' })).toEqual(['PAYPAL_WEBHOOK_ID']);
});
