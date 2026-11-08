import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const { space, radii, borderWidth } = config;

/** The divider's grip across the line it draws, thick enough to take a pointer. */
const DIVIDER_GRIP = toRem(12);
/** Even under a short window the stage keeps a face's height, as it does alone (CallStage.css.ts). */
const STAGE_MIN_HEIGHT = toRem(80);
/** Read out, never seen: a box of one pixel, clipped away. */
const UNSEEN = toRem(1);
/** The subtitle shows the latest line in at most this many lines of text, cut short after. */
const SUBTITLE_LINES = 2;
/** The subtitle sits on the scrim of the tiles' names, readable on video and plain tiles alike. */
const SCRIM = 'rgba(0, 0, 0, 0.55)';

// The stage and the transcript under it; beside it (at the end side) in the side layout. Without
// a transcript the stage alone fills it, as it fills the body.
export const Split = style({
  position: 'relative',
  display: 'flex',
  flexFlow: 'column nowrap',
  flex: '1 1 0',
  minHeight: STAGE_MIN_HEIGHT,
  minWidth: 0,
  selectors: { '&[data-call-transcript-layout="side"]': { flexFlow: 'row nowrap' } },
});

// Its share of the split is set on it; its minimum height is the stage's own.
export const StagePane = style({ display: 'flex', flexFlow: 'column nowrap', flex: '1 1 0' });

export const Pane = style({ display: 'flex', flex: '1 1 0', minHeight: 0, minWidth: 0 });

// The transcript scrolls in its pane, newest at the bottom (LiveTranscriptBody).
export const PaneBody = style({
  display: 'flex',
  flexFlow: 'column nowrap',
  flex: '1 1 0',
  gap: space.S300,
  minHeight: 0,
  overflowY: 'auto',
  paddingBlock: space.S200,
  paddingInline: space.S100,
});

// The subtitle layout keeps the transcript for screen readers, out of sight. It stays a flex box
// as the pane is, so the transcript keeps scrolling in a box of its own and keeps its place.
export const PaneUnseen = style({
  display: 'flex',
  position: 'absolute',
  inlineSize: UNSEEN,
  blockSize: UNSEEN,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
});

const hairline = `${borderWidth.B300} solid ${color.Background.ContainerLine}`;
const focusLine = `${borderWidth.B400} solid ${color.Primary.Main}`;

// A grip with a hairline through its middle, across the split: a row under the stage, a column
// beside it. A pointer on it drags rather than selecting text or scrolling.
export const Divider = style({
  flex: `0 0 ${DIVIDER_GRIP}`,
  display: 'flex',
  flexFlow: 'column nowrap',
  justifyContent: 'center',
  cursor: 'row-resize',
  touchAction: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
  outline: 'none',
  selectors: {
    '&::after': { content: '""', borderBlockStart: hairline },
    '&:hover::after, &:focus-visible::after': { borderBlockStart: focusLine },
    [`${Split}[data-call-transcript-layout="side"] > &`]: {
      flexFlow: 'row nowrap',
      cursor: 'col-resize',
    },
    [`${Split}[data-call-transcript-layout="side"] > &::after`]: {
      borderBlockStart: 'none',
      borderInlineStart: hairline,
    },
    [`${Split}[data-call-transcript-layout="side"] > &:is(:hover, :focus-visible)::after`]: {
      borderInlineStart: focusLine,
    },
  },
});

// The latest line over the bottom of the stage, two lines at most; presses go through it to the
// stage.
export const Subtitle = style({
  position: 'absolute',
  insetInline: space.S300,
  insetBlockEnd: space.S300,
  zIndex: 3,
  margin: 0,
  paddingBlock: space.S100,
  paddingInline: space.S200,
  borderRadius: radii.R300,
  background: SCRIM,
  color: '#fff',
  textAlign: 'center',
  pointerEvents: 'none',
  overflowWrap: 'anywhere',
  display: '-webkit-box',
  WebkitLineClamp: SUBTITLE_LINES,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});

export const SubtitleName = style({ fontWeight: 600 });
