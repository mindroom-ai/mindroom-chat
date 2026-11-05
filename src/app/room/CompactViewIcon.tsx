import type { IconSrc } from 'folds';

/**
 * The Compact view's icon: a rounded card cut into two bars, the way that view stacks threads
 * as equal-height bars. Drawn on folds' 24-unit grid with its 2-unit stroke.
 */
export const CompactViewIcon: IconSrc = () => (
  <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
    <rect x="5" y="5" width="14" height="14" rx="3" />
    <path d="M5 12h14" />
  </g>
);
