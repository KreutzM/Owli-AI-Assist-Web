import { STAGING_API_ROOT } from '@/core/config/runtimeConfig';

export function startBackendRequestTracking(): { count(): number; stop(): void } {
  let backendRequests = 0;
  const backendOrigin = new URL(STAGING_API_ROOT).origin;
  const originalFetch = window.fetch.bind(window);
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalOpen = XMLHttpRequest.prototype.open;

  window.fetch = async (...args) => {
    if (isBackendRequest(args[0], backendOrigin)) backendRequests += 1;
    return await originalFetch(...args);
  };

  XMLHttpRequest.prototype.open = function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    if (isBackendUrl(url, backendOrigin)) backendRequests += 1;
    originalOpen.call(this, method, url, async ?? true, username, password);
  };

  return {
    count() {
      return backendRequests;
    },
    stop() {
      window.fetch = originalFetch;
      XMLHttpRequest.prototype.open = originalOpen;
    },
  };
}

function isBackendRequest(input: RequestInfo | URL, backendOrigin: string): boolean {
  if (typeof input === 'string' || input instanceof URL) {
    return isBackendUrl(input, backendOrigin);
  }
  return isBackendUrl(input.url, backendOrigin);
}

function isBackendUrl(value: string | URL, backendOrigin: string): boolean {
  try {
    return new URL(String(value), window.location.origin).origin === backendOrigin;
  } catch {
    return false;
  }
}
