// Munshi for Zapier: three polling triggers on Munshi's read-only integration feed. No actions: nothing in Zapier can
// change a shop's books; every change in Munshi stays a named person's approval.
'use strict';

const authentication = require('./authentication');
const newFinding = require('./triggers/new_finding');
const paypalLinkMade = require('./triggers/paypal_link_made');
const paypalPaymentWaiting = require('./triggers/paypal_payment_waiting');

// Every request carries the integration key as a bearer token.
const addKey = (request, z, bundle) => {
  request.headers = { ...(request.headers || {}), authorization: `Bearer ${bundle.authData.apiKey}`, accept: 'application/json' };
  return request;
};

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,
  authentication,
  beforeRequest: [addKey],
  triggers: {
    [paypalPaymentWaiting.key]: paypalPaymentWaiting,
    [paypalLinkMade.key]: paypalLinkMade,
    [newFinding.key]: newFinding,
  },
  searches: {},
  creates: {},
};
