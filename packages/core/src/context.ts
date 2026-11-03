// The request a piece of work belongs to, held in async context so a log line or an API error body can
// name its request id without every function passing it down. The request hook sets x-request-id; a route that logs
// runs its work inside withRequest.
import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestContext = { requestId: string; tenantId?: string };

const store = new AsyncLocalStorage<RequestContext>();

export const withRequest = <T>(context: RequestContext, fn: () => T): T => store.run(context, fn);

export const currentRequest = (): RequestContext | undefined => store.getStore();
