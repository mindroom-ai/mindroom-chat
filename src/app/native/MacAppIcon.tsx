import type { IconSrc } from 'folds';

/**
 * The Mac app's icon: a laptop, its screen over a base a little wider. Drawn on folds' 24-unit
 * grid with its 2-unit stroke.
 */
export const MacAppIcon: IconSrc = () => (
  <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="5" width="16" height="11" rx="2" />
    <path d="M2 19h20" />
  </g>
);
