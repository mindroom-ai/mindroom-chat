/**
 * The flag React 18 reads to know that a test drives its updates through `act()`. Component tests
 * set it on `globalThis` before they render.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

export {};
