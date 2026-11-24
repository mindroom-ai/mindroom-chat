import type { IconSrc } from 'folds';

// Drawn on folds' 24-unit grid from scripts/branding/mindroom-logo-mark.svgz
// (viewBox="152 112 720 720"): outer isometric M frame and central isometric cube.

const OUTLINE_FRAME =
  'M2.5 5.1 6.45 2.65 12 6.25 17.55 2.65 21.5 5.1V19.45L18.2 21.35 14.4 18.85V15.25L12 16.75 9.6 15.25V18.85L5.8 21.35 2.5 19.45Z';
const OUTLINE_CUBE =
  'M9.6 15.25 7.75 14.1V8.9L12 6.25 16.25 8.9V14.1L14.4 15.25M7.75 8.9 12 11.5 16.25 8.9M12 11.5V16.75';

const FILLED_PATH =
  'M2 4.75 6.15 2.15 12 5.95 17.85 2.15 22 4.75V19.85L18.5 21.85 14.55 19.2V15.4L12 17 9.45 15.4V19.2L5.5 21.85 2 19.85Z' +
  'M8.5 9.1 12 7.1 15.5 9.1 12 11.1Z' +
  'M7.9 10.2 11.25 12.2V15.6L7.9 13.6Z' +
  'M16.1 10.2 12.75 12.2V15.6L16.1 13.6Z';

/** MindRoom's isometric M-cube mark, outlined by default and solid with cube cutouts when active. */
export const MindroomIcon: IconSrc = (filled) =>
  filled ? (
    <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d={FILLED_PATH} />
  ) : (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d={OUTLINE_FRAME} />
      <path d={OUTLINE_CUBE} />
    </g>
  );
