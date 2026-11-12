// Custom auth: the deployment's integration key (MUNSHI_INTEGRATION_SECRET), where Munshi runs, and which shop.
'use strict';

const { fetchFeed } = require('./feed');

module.exports = {
  type: 'custom',
  fields: [
    {
      key: 'baseUrl',
      label: 'Munshi URL',
      required: true,
      type: 'string',
      default: 'https://munshi-sable.vercel.app',
      helpText: 'Where your Munshi web app runs, e.g. `https://munshi-sable.vercel.app`.',
    },
    {
      key: 'shop',
      label: 'Shop slug',
      required: true,
      type: 'string',
      default: 'sharma-general-store',
      helpText: 'The shop’s slug, e.g. `sharma-general-store` (the demo kirana). The feed serves sample shops only.',
    },
    {
      key: 'apiKey',
      label: 'Integration key',
      required: true,
      type: 'password',
      helpText: 'The deployment’s MUNSHI_INTEGRATION_SECRET. It opens a read-only feed: nothing in Zapier can change the shop’s books.',
    },
  ],
  test: async (z, bundle) => {
    const feed = await fetchFeed(z, bundle);
    return { shop: feed.shop.name, label: feed.shop.label };
  },
  connectionLabel: '{{bundle.authData.shop}}',
};
