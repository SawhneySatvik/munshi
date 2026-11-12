// The one call every trigger makes: GET <baseUrl>/api/integrations/v1/feed?shop=<slug>, Bearer the integration key.
// Munshi answers a wrong key, an unknown shop and a real shop alike with a bare 404, so that is the error Zapier shows.
// Read only: nothing here, and nothing behind that route, writes to the shop's books.
'use strict';

const trimBase = (url) => String(url || '').replace(/\/+$/, '');

const feedUrl = (bundle) => `${trimBase(bundle.authData.baseUrl)}/api/integrations/v1/feed`;

async function fetchFeed(z, bundle) {
  const response = await z.request({
    url: feedUrl(bundle),
    method: 'GET',
    params: { shop: bundle.authData.shop },
    skipThrowForStatus: true,
  });
  if (response.status === 404) {
    throw new z.errors.Error(
      'Munshi did not recognise this connection: check the integration key, the base URL and the shop slug (the feed serves sample shops only).',
      'AuthenticationError',
      404,
    );
  }
  response.throwForStatus();
  return response.data;
}

// The shop's labels ride on every item, so a Slack message or a sheet row can say it is a sample shop on PayPal's sandbox.
const shopFields = (feed) => ({
  shop_slug: feed.shop.slug,
  shop_name: feed.shop.name,
  shop_label: feed.shop.label,
  paypal_label: feed.shop.paypal,
});

const sourceText = (source) => (!source ? null : source.kind === 'snapshot' ? source.ref : `${source.table}:${source.id}`);

const amountFields = (prefix, amount) => ({
  [prefix]: amount ? amount.display : null,
  [`${prefix}_minor`]: amount ? amount.minor : null,
  [`${prefix}_currency`]: amount ? amount.currency : null,
  [`${prefix}_source`]: amount ? sourceText(amount.source) : null,
});

module.exports = { amountFields, feedUrl, fetchFeed, shopFields, sourceText };
