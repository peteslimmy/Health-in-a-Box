import { AsyncLocalStorage } from 'async_hooks';

type RequestContext = { correlationId: string };

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return storage.run(context, callback);
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
