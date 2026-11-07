/**
 * Props that start loading what a control opens once the pointer or the focus reaches it, so the
 * click finds the code there. The load is the dynamic import the part itself uses: the browser
 * fetches a module once, so the part's own load gets the same module, and a failure is left to
 * that load to report. Chrome 145 and Safari 26 keep a failed import until the page reloads
 * (`ui/partRetry.ts`), so this suits parts whose own load offers Retry (`lazyPart`), and nothing
 * starts offline, where a chunk the service worker did not keep cannot load.
 */
export const preloadOnIntent = (load: () => Promise<unknown>) => {
  const preload = () => {
    if (navigator.onLine) load().catch(() => undefined);
  };
  return { onPointerEnter: preload, onFocus: preload };
};
