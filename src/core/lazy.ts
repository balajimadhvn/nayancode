/* eslint-disable @typescript-eslint/no-explicit-any */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/** React.lazy caches a rejected import forever, so one transient failure (dev server mid-compile, a flaky
 *  network, a just-redeployed chunk) would leave a studio broken until the page is reloaded.
 *  Retry a few times before giving up; the error boundary then offers an automatic reload. */
export function lazyRetry<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>, tries = 4, delayMs = 700): LazyExoticComponent<T> {
  return lazy(async () => {
    let last: unknown;
    for (let i = 0; i < tries; i++) {
      try { return await factory(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, delayMs * (i + 1))); }
    }
    throw last;
  });
}
