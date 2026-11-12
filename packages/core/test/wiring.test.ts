// A Next server loads core once per bundle: the request hook that boots and wires the senders, each route, each server
// action. What boot wires must reach the sweep in whichever copy runs it, or an approved PayPal link or message waits
// for ever. Two imports with different query strings are two copies of the same module here, as in the server.
import { afterEach, expect, test } from 'vitest';

type PayPalSlot = { wirePayPal: (p: unknown) => void; wiredPayPal: () => unknown };
type ChannelSlot = { wireChannels: (c: unknown) => void; wiredChannels: () => unknown };

// One copy of a module per query string (a specifier the compiler does not resolve).
const copy = <T>(file: string, name: string): Promise<T> => import(`../src/${file}?copy=${name}`) as Promise<T>;

afterEach(async () => {
  const a = await copy<PayPalSlot>('jobs-paypal.ts', 'boot');
  a.wirePayPal(null);
  const o = await copy<ChannelSlot>('outbox.ts', 'boot');
  o.wireChannels(null);
});

test('a PayPal adapter wired in one copy of core is the one every other copy sweeps with', async () => {
  const boot = await copy<PayPalSlot>('jobs-paypal.ts', 'boot');
  const route = await copy<PayPalSlot>('jobs-paypal.ts', 'route');
  expect(boot).not.toBe(route);
  const adapter = { mode: 'recorded', label: 'PayPal sandbox' };
  boot.wirePayPal(adapter);
  expect(route.wiredPayPal()).toBe(adapter);
  route.wirePayPal(null);
  expect(boot.wiredPayPal()).toBeNull();
});

test('senders wired in one copy of core are the ones every other copy sweeps with', async () => {
  const boot = await copy<ChannelSlot>('outbox.ts', 'boot');
  const route = await copy<ChannelSlot>('outbox.ts', 'route');
  expect(boot).not.toBe(route);
  const channels = { recorded: () => undefined };
  boot.wireChannels(channels);
  expect(route.wiredChannels()).toBe(channels);
  route.wireChannels(null);
  expect(boot.wiredChannels()).toBeNull();
});
