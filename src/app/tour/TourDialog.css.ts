import { keyframes, style, styleVariants } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { motion } from '../ui/styles/Motion.css';
import { transition } from '../ui/styles/transition';

const { space } = config;

const replayIn = keyframes({ from: { opacity: 0 } });

/**
 * The tour's dialog on screens wider than a phone: 720 px wide and as tall as its content, up to
 * the window less a margin. A phone's dialog fills the screen instead.
 */
export const Dialog = style({
  selectors: {
    '&&': {
      maxWidth: `min(${toRem(720)}, calc(100% - 2 * ${space.S400}))`,
      maxHeight: `min(${toRem(780)}, calc(100% - 2 * ${space.S400}))`,
    },
  },
});

/**
 * The dialog's content, top to bottom: title row, stage, text, progress, buttons. A window too
 * low even for the stage at its least height and the buttons scrolls the whole of it.
 */
export const Content = style({
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
});

/** The level's name and the step's number, then the close button. */
export const TitleRow = style({
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  columnGap: space.S200,
  padding: space.S400,
  paddingBlockEnd: space.S300,
});

export const Title = style({
  display: 'flex',
  alignItems: 'baseline',
  flexWrap: 'wrap',
  flexGrow: 1,
  minWidth: 0,
  columnGap: space.S300,
});

/**
 * The stage on a wider screen: one height for every step, which only a window too short for the
 * dialog makes smaller. It gives way before the text does.
 */
export const Stage = style({
  flex: `0 1000 ${toRem(432)}`,
  // The room is not drawn below 0.6 of its size (TourStage.tsx): a lower stage would cut it off.
  // In rem, like the room, so the page zoom keeps the two in step.
  minHeight: toRem(294),
  marginInline: space.S400,
});

/** A phone's stage takes the height the text and the buttons leave. */
export const PhoneStage = style({
  flex: '1 1 0',
  // As above, for a phone's lower room.
  minHeight: toRem(236),
  marginInline: space.S300,
});

/**
 * The chapter's name over the step's title and text. Where the window is too low for it beside
 * the stage at its least height, it scrolls, so the stage and the buttons stay.
 */
export const TextBlock = style({
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 1,
  minHeight: 0,
  overflowY: 'auto',
  rowGap: space.S100,
  paddingInline: space.S400,
  paddingBlockStart: space.S400,
});

export const PhoneTextBlock = style({
  paddingInline: space.S300,
  paddingBlockStart: space.S300,
});

/**
 * The chapter's name with Replay at its end. As tall as the button whether or not it shows, so
 * the title under it never moves.
 */
export const ChapterRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  columnGap: space.S200,
  minHeight: toRem(32),
});

/** Replay comes in softly once a scene has played. */
export const Replay = style({
  flexShrink: 0,
  // Its label ends where the text block does, its own padding hanging outside.
  marginInlineEnd: `calc(-1 * ${space.S200})`,
  animation: `${replayIn} ${motion.duration.Slow} ${motion.easing.Standard} both`,
  '@media': { '(prefers-reduced-motion: reduce)': { animation: 'none' } },
});

/** The chapter's name: small capitals in the accent color. */
export const Chapter = style({
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: config.fontWeight.W600,
  color: color.Primary.Main,
});

/**
 * Holds every step's text in one cell, only the current one visible, so the block is as tall as
 * the tallest step and the buttons below it never move.
 */
export const TextGrid = style({ display: 'grid' });

/** One step's title and text. */
export const StepText = style({
  gridArea: '1 / 1',
  display: 'flex',
  flexDirection: 'column',
  rowGap: space.S100,
  minWidth: 0,
});

/** A step's text that only takes up its room. */
export const StepTextSizer = style({
  visibility: 'hidden',
  pointerEvents: 'none',
  userSelect: 'none',
});

/** The states step's four rows: each state's name in a pill, then what it means. */
export const States = style({
  display: 'grid',
  gridTemplateColumns: 'max-content minmax(0, 1fr)',
  alignItems: 'baseline',
  columnGap: space.S300,
  rowGap: space.S200,
  paddingBlockStart: space.S100,
});

/** Text for a screen reader only. */
export const Unseen = style({
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
});

const StatePillBase = style({
  justifySelf: 'start',
  display: 'inline-flex',
  alignItems: 'center',
  columnGap: space.S100,
  paddingInline: space.S200,
  paddingBlock: toRem(1),
  borderRadius: config.radii.Pill,
  border: `${config.borderWidth.B300} solid`,
  whiteSpace: 'nowrap',
});

/** A state's pill, in the colors its card takes. */
export const StatePill = styleVariants(
  {
    streaming: color.SurfaceVariant,
    unread: color.Primary,
    resolved: color.Success,
    snoozed: color.Warning,
  },
  (tone) => [
    StatePillBase,
    { backgroundColor: tone.Container, borderColor: tone.ContainerLine, color: tone.OnContainer },
  ]
);

/** The progress bar: one segment per step. */
export const Progress = style({
  display: 'flex',
  flexShrink: 0,
  columnGap: toRem(4),
  paddingInline: space.S400,
  paddingBlock: space.S400,
});

export const PhoneProgress = style({
  paddingInline: space.S300,
  paddingBlock: space.S300,
});

export const Segment = style({
  flex: '1 1 0',
  blockSize: toRem(4),
  borderRadius: config.radii.Pill,
  backgroundColor: color.SurfaceVariant.ContainerLine,
  transition: transition(['background-color'], motion.duration.Slow),
});

/** A step that is reached. */
export const SegmentReached = style({ backgroundColor: color.Primary.Main });

/** The first step of a later chapter stands a little apart. */
export const SegmentOfNewChapter = style({ marginInlineStart: space.S200 });

/** Back at the start, then the step's main button at the end, with Keep going before it. */
export const Buttons = style({
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  columnGap: space.S200,
  paddingInline: space.S400,
  paddingBlockEnd: space.S400,
});

export const PhoneButtons = style({
  paddingInline: space.S300,
  paddingBlockEnd: space.S300,
});

export const ButtonSpacer = style({ flexGrow: 1 });

/** Keep going gives way before the row would wrap, so the other buttons keep their places. */
export const Shrinkable = style({ flexShrink: 1, minWidth: 0 });
