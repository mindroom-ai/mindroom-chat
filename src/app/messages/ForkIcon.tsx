import type { IconSrc } from 'folds';

/** A line that splits in two, for starting a fork of a thread. */
export const ForkIcon: IconSrc = () => (
  <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="5" r="2" />
    <circle cx="18" cy="5" r="2" />
    <circle cx="12" cy="19" r="2" />
    <path d="M6 7v1a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V7M12 12v5" />
  </g>
);
