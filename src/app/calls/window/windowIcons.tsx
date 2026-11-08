import type { IconSrc } from 'folds';

// Drawn with the reading direction in mind: the side column and the small window sit at the end
// edge, so the icons mirror (`data-directional`) in right-to-left languages.
const OUTLINE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinejoin: 'round',
} as const;

/** The call view moving into the room's side column: a window with its end column filled. */
export const DockIcon: IconSrc = () => (
  <g>
    <rect x="3" y="4" width="18" height="16" rx="2" {...OUTLINE} />
    <rect x="14" y="7" width="4" height="10" rx="1" fill="currentColor" />
  </g>
);

/** The call view floating over the page: a window with a small one in its bottom end corner. */
export const FloatIcon: IconSrc = () => (
  <g>
    <rect x="3" y="4" width="18" height="16" rx="2" {...OUTLINE} />
    <rect x="12" y="12" width="6" height="5" rx="1" fill="currentColor" />
  </g>
);
