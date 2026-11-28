import type { IconSrc } from 'folds';

/**
 * The Columns switch's icon: three side-by-side columns, the way Columns transposes the status
 * sections horizontally. Drawn on folds' 24-unit grid with its 2-unit stroke.
 */
export const ColumnsThreadsIcon: IconSrc = () => (
  <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="4.5" height="16" rx="1.5" />
    <rect x="9.75" y="4" width="4.5" height="16" rx="1.5" />
    <rect x="16.5" y="4" width="4.5" height="16" rx="1.5" opacity=".6" />
  </g>
);
