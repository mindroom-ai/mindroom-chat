/** What the page's media queries answer in a test; jsdom has no `matchMedia` of its own. */
type Media = { reducedMotion?: boolean; touch?: boolean };

/** Stands in for `window.matchMedia`: reduced motion and a coarse pointer as given. */
export const mockMedia = ({ reducedMotion = false, touch = false }: Media = {}): void => {
  const matches = (query: string): boolean =>
    (reducedMotion && query.includes('prefers-reduced-motion')) ||
    (touch && query.includes('pointer: coarse'));
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: matches(query),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
};

/** Takes the stand-in away again, as jsdom has it. */
export const restoreMedia = (): void => {
  Reflect.deleteProperty(window, 'matchMedia');
};
