/**
 * The precache downloads the crypto wasm past the HTTP cache.
 *
 * Chromium lets requests for one URL that run at the same time share one HTTP cache entry while
 * it is written, and fails the ones waiting on it with ERR_CACHE_WRITE_FAILURE when that write
 * fails. It fails for a file larger than the cache takes: the 7.8 MB wasm in an in-memory cache
 * (private windows, test browsers). A worker that installs while the page starts an account, as
 * on the first start after Clear Cache & Reload, downloads the wasm when the page does, and the
 * page's download failed: "WebAssembly compilation aborted: Network error: Response body loading
 * was aborted". The crypto module keeps that failure until the page reloads, so Retry could not
 * help either. Downloaded past the HTTP cache, the worker's request shares nothing with the
 * page's. It costs a second download only where the HTTP cache already held the wasm.
 */
export const precacheFetchPlugin = {
  requestWillFetch: async ({ request }: { request: Request }): Promise<Request> =>
    new URL(request.url).pathname.endsWith('.wasm')
      ? new Request(request, { cache: 'no-store' })
      : request,
};
