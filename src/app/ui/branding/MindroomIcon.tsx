import type { IconSrc } from 'folds';
import { MINDROOM_FAVICON_SRC } from './branding';

/**
 * MindRoom's full-color isometric M-cube mark on folds' 24-unit icon grid, inset slightly so it
 * matches the optical size of surrounding icons.
 */
export const MindroomIcon: IconSrc = () => (
  <image
    href={MINDROOM_FAVICON_SRC}
    x="1"
    y="1"
    width="22"
    height="22"
    preserveAspectRatio="xMidYMid meet"
  />
);
