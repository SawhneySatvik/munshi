// The embeddable widgets (platform spec §4): web components built on the SDK and a site's publishable key. The built
// file, apps/web/public/widgets/munshi-order.js (build.ts), is this module as one classic script with no imports, so a
// plain page loads it with <script src> from any origin; its API calls are answered only from the site's own origins.
import { MunshiOrder } from './order.ts';

export { MunshiOrder };

if (typeof customElements !== 'undefined' && !customElements.get('munshi-order')) customElements.define('munshi-order', MunshiOrder);
