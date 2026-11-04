import React, { type ReactNode, useSyncExternalStore } from 'react';
import type { KatexOptions } from 'katex';

// KaTeX (about 270 kB) loads with the first message that has math, not with the app: the notice
// banners on the sign-in page reach `plugins/math.tsx` through the Markdown rules, and that file
// takes its `katex` from here. Until KaTeX is in, rendering throws, so `renderLatexToHtml` shows
// the TeX source; the `WithKatex` boundaries around math render again once it arrives.

type Katex = { renderToString: (tex: string, options?: KatexOptions) => string };

let katex: Katex | undefined;
let request: Promise<Katex> | undefined;
const listeners = new Set<() => void>();

/** Loads KaTeX once; a failed load is tried again on the next call. */
export const loadKatex = (): Promise<Katex> => {
  // Its style sheet comes along: without it the MathML copy KaTeX writes for screen readers
  // shows beside the typeset formula.
  request ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(
    ([module]) => {
      katex = module.default;
      listeners.forEach((listener) => listener());
      return katex;
    },
    (error: unknown) => {
      request = undefined;
      throw error;
    }
  );
  return request;
};

export const isKatexLoaded = (): boolean => katex !== undefined;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const warnLoadFailure = (error: unknown) => {
  // eslint-disable-next-line no-console
  console.warn('[math] KaTeX did not load; math shows as TeX', error);
};

/** KaTeX's `renderToString`, which starts loading KaTeX and throws until it has loaded. */
const lazyKatex: Katex = {
  renderToString: (tex, options) => {
    if (katex) return katex.renderToString(tex, options);
    loadKatex().catch(warnLoadFailure);
    throw new Error('KaTeX is still loading');
  },
};

export default lazyKatex;

/**
 * Calls `render` again once KaTeX has loaded, so math rendered before that, as TeX source,
 * becomes typeset. Content without math renders as it would without the boundary.
 */
export function WithKatex({ render }: { render: () => ReactNode }) {
  useSyncExternalStore(subscribe, isKatexLoaded, isKatexLoaded);
  return <>{render()}</>;
}
