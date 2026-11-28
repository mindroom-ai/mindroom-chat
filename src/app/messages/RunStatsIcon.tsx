import type { IconSrc } from 'folds';

/** Three rounded vertical bars, for an agent reply's run stats and details. */
export const RunStatsIcon: IconSrc = () => (
  <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 19v-6" />
    <path d="M12 19V5" />
    <path d="M18 19v-9" />
  </g>
);
