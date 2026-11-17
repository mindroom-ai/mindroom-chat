import type { IconSrc } from 'folds';

/**
 * The Group switch's icon: three stacked layers, the way Group stacks the cards by status.
 * Drawn on folds' 24-unit grid with its 2-unit stroke.
 */
export const GroupThreadsIcon: IconSrc = () => (
  <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l9 5-9 5-9-5z" />
    <path d="M3 12.5l9 5 9-5" />
    <path d="M3 17l9 5 9-5" opacity=".6" />
  </g>
);
