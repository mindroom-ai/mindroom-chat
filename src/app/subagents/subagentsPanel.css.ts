import { style, styleVariants } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { Panel as SidePanelPanel } from '../ui/panels/SidePanel.css';
import { Panel as DisclosurePanel } from '../ui/ThreadActivity.css';

const { space, radii, borderWidth } = config;
const AVATAR = toRem(24);
const quietLine = `${borderWidth.B300} solid ${color.Surface.ContainerLine}`;
// Inside a Show output panel, set in from its border as that panel's rows are
// (ThreadActivity.css.ts `Row`); the panel's border is their frame.
const inDisclosure = {
  paddingBlock: toRem(10),
  paddingInlineStart: toRem(12),
  paddingInlineEnd: toRem(14),
};

// It fills its column, and on phones the room's width, as the room's other side panels do.
export const Panel = style([SidePanelPanel, { flexGrow: 1 }]);

export const Heading = style({
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minWidth: 0,
});

// The runs, top to bottom; the panel scrolls, each running transcript in its own box too.
export const Runs = style({
  display: 'flex',
  flexDirection: 'column',
  gap: space.S300,
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  padding: space.S300,
});

export const Empty = style({ paddingBlock: space.S400, textAlign: 'center' });

/** One run: who and how it stands, where it came from, then what it wrote. */
export const Card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: space.S200,
  minWidth: 0,
  paddingBlock: space.S300,
  paddingInline: space.S300,
  borderRadius: radii.R400,
  border: quietLine,
  background: color.Surface.Container,
  color: color.Surface.OnContainer,
});

// The avatar beside the name over the status line, as a reply's sender sits by its body; the way
// back to the caller's thread at the end.
export const Who = style({
  display: 'grid',
  gridTemplateColumns: `${AVATAR} minmax(0, 1fr) auto`,
  columnGap: space.S200,
  alignItems: 'center',
});

export const Name = style({ fontWeight: 600 });

export const Standing = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: space.S200,
  color: color.SurfaceVariant.OnContainer,
});

// A small round mark in the status's color, on the line before its word.
const dot = style({
  display: 'inline-block',
  verticalAlign: 'middle',
  inlineSize: toRem(8),
  blockSize: toRem(8),
  marginInlineEnd: space.S100,
  borderRadius: radii.Pill,
});

/** The status's dot: green while it works, amber while it waits on someone, red when it failed. */
export const StatusDot = styleVariants({
  running: [dot, { background: color.Success.Main }],
  awaiting_approval: [dot, { background: color.Warning.Main }],
  paused: [dot, { background: color.SurfaceVariant.OnContainer }],
  completed: [dot, { background: color.Success.Main, opacity: config.opacity.P300 }],
  failed: [dot, { background: color.Critical.Main }],
  cancelled: [dot, { background: color.SurfaceVariant.OnContainer }],
  denied: [dot, { background: color.Critical.Main }],
});

// The task beside its press to show all of it, when two lines cut it short.
export const TaskRow = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  columnGap: space.S100,
  alignItems: 'start',
});

// What the run was asked, quieter than what it answers, keeps its line breaks and wraps anywhere.
export const Task = style({
  margin: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});

/** Two lines of the task at most. */
export const TaskExcerpt = style([
  Task,
  { overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' },
]);

export const Result = style({
  minWidth: 0,
  overflowWrap: 'anywhere',
  selectors: {
    // A folded run's, in its Show output panel above its transcript.
    [`${DisclosurePanel} > &`]: inDisclosure,
  },
});

// A transcript as long as a reply would be scrolls in a box of its own, so the runs below it
// stay in reach; its newest text shows at the box's end.
export const Transcript = style({
  maxHeight: toRem(320),
  minWidth: 0,
  overflowY: 'auto',
  overflowWrap: 'anywhere',
  paddingBlockStart: space.S200,
  borderBlockStart: quietLine,
  selectors: {
    // A finished run's, in its Show output panel, has no line of its own under the panel's.
    [`${DisclosurePanel} > &`]: { ...inDisclosure, borderBlockStart: 'none' },
    [`${DisclosurePanel} > ${Result} + &`]: { borderBlockStart: quietLine },
  },
});

/** Cards one under the other, without the marks of a list. */
export const List = style({
  display: 'flex',
  flexDirection: 'column',
  gap: space.S300,
  margin: 0,
  padding: 0,
  listStyle: 'none',
});

/** The runs a run started, inside its card and set in from the start edge by a quiet line. */
export const Nested = style([
  List,
  {
    gap: space.S200,
    paddingInlineStart: space.S300,
    borderInlineStart: `${borderWidth.B600} solid ${color.Surface.ContainerLine}`,
  },
]);
