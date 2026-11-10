import type { IconSrc } from 'folds';

// Drawn on folds' 24-unit grid with the 1.5-unit bars of its Hash. A work room's hash sits in a
// rounded frame, so the frame says what kind of room it is and the corner badge stays free to say
// who can join, as folds' HashLock and HashGlobe do for other rooms.

const innerHash = <path d="M9.5 7V17M14.5 7V17M7 9.5H17M7 14.5H17" />;

/** A work room anyone with the link can join, or one without a known join rule. */
export const WorkRoomIcon: IconSrc = () => (
  <g fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="2.75" y="2.75" width="18.5" height="18.5" rx="4" />
    {innerHash}
  </g>
);

/** The frame with its top end corner left open for a badge. */
const openFrame = <path d="M13 2.75H6.75a4 4 0 0 0-4 4v10.5a4 4 0 0 0 4 4h10.5a4 4 0 0 0 4-4V11" />;

/** A work room only invited members, or members who knocked, can join. */
export const WorkRoomLockIcon: IconSrc = () => (
  <g fill="none" stroke="currentColor" strokeWidth="1.5">
    {openFrame}
    {innerHash}
    <path d="M17.75 3.75v-1a1.75 1.75 0 0 1 3.5 0v1" />
    <rect
      x="16.25"
      y="3.75"
      width="6.5"
      height="4.75"
      rx="0.75"
      fill="currentColor"
      stroke="none"
    />
  </g>
);

/** A public work room. */
export const WorkRoomGlobeIcon: IconSrc = () => (
  <g fill="none" stroke="currentColor" strokeWidth="1.5">
    {openFrame}
    {innerHash}
    <circle cx="19.5" cy="4.5" r="3.5" />
    <ellipse cx="19.5" cy="4.5" rx="1.25" ry="3.5" strokeWidth="1.25" />
  </g>
);
