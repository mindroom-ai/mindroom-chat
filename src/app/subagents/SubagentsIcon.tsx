import type { IconSrc } from 'folds';

/**
 * The Sub-agents panel's icon: an agent at the top whose line branches to the two it started.
 * Drawn on folds' 24-unit grid with its 2-unit stroke.
 */
export const SubagentsIcon: IconSrc = () => (
  <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="5.5" r="2.5" />
    <path d="M12 8v4M6 15.5V14a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1.5" />
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
  </g>
);
