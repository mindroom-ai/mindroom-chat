/**
 * Props that start loading what a control opens once the pointer or the focus reaches it, so the
 * click finds the code there. Each load is the dynamic import the part itself uses: the browser
 * fetches a module once, so the part's own load gets the same module, and a failure is left to
 * that load to report. Offline nothing starts: Chrome 145 and Safari 26 remember a failed import
 * until the page reloads (`ui/partRetry.ts`), so a load that failed offline would keep the part
 * from loading after the device came back.
 */
export const preloadOnIntent = (...loads: Array<() => Promise<unknown>>) => {
  const preload = () => {
    if (!navigator.onLine) return;
    loads.forEach((load) => {
      load().catch(() => undefined);
    });
  };
  return { onPointerEnter: preload, onFocus: preload };
};
