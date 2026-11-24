import type { IconSrc } from 'folds';

/**
 * The Triggers button and dialog icon: a lightning bolt matching the wake pill's mark.
 * Drawn on folds' 24-unit grid with its 2-unit stroke.
 */
export const TriggersIcon: IconSrc = () => (
  <path
    d="M13 3v7h6l-8 11v-7H5l8-11"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
);
