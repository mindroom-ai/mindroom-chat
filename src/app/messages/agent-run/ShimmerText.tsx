import type { ReactNode } from 'react';
import * as css from './ShimmerText.css';

/**
 * Text that glistens as the thinking placeholder's label does: a gradient under a masked sweep of
 * counter-moving copy, still under reduced motion and forced colours. Hidden from screen readers;
 * the caller names it (`role="status"` with an `aria-label`).
 */
export function ShimmerText({ children }: { children: ReactNode }) {
  return (
    <span className={css.Text} aria-hidden="true">
      <span className={css.TextBase}>{children}</span>
      <span className={css.TextSweep}>
        <span className={css.TextCounter}>
          <span className={css.TextHighlight}>{children}</span>
        </span>
      </span>
    </span>
  );
}
