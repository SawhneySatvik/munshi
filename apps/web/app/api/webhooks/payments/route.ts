// The PayPal webhook under a second path. PayPal's dashboard may refuse a webhook URL that names PayPal, so this
// path serves the same handler, with the same checks; either may be registered.
export { POST } from "../paypal/route";
