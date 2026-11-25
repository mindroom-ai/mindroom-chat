/** What the page's media queries answer in a test; jsdom has no `matchMedia` of its own. */
type Media = { reducedMotion?: boolean; touch?: boolean; noHover?: boolean };

/** Stands in for `window.matchMedia`: reduced motion, coarse pointer, and hover capability. */
export const mockMedia = ({
  reducedMotion = false,
  touch = false,
  noHover = false,
}: Media = {}): void => {
  const matches = (query: string): boolean =>
    (reducedMotion && query.includes('prefers-reduced-motion')) ||
    (touch && query.includes('pointer: coarse')) ||
    (noHover && query.includes('hover: none'));
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
