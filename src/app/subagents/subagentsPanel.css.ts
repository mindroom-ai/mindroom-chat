import { style, styleVariants } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { Panel as SidePanelPanel } from '../ui/panels/SidePanel.css';

const { space, radii, borderWidth } = config;
const quietLine = `${borderWidth.B300} solid ${color.Surface.ContainerLine}`;

// It fills its column, and on phones the room's width, as the room's other side panels do.
export const Panel = style([SidePanelPanel, { flexGrow: 1 }]);

export const Heading = style({
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minWidth: 0,
});

/** The open run's status and time under its name. */
export const Standing = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: space.S200,
});

// The list, or the open run; the panel's header stays put above it.
export const Body = style({
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  padding: space.S300,
});

export const Empty = style({ display: 'block', paddingBlock: space.S400, textAlign: 'center' });

/** Cards one under the other, without the marks of a list. */
export const List = style({
  display: 'flex',
  flexDirection: 'column',
  gap: space.S200,
  margin: 0,
  padding: 0,
  listStyle: 'none',
});

/** One run as a compact thread card: title and time, a line of text, then who and how. */
export const Card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: space.S100,
  width: '100%',
  minWidth: 0,
  padding: `${space.S200} ${space.S300}`,
  border: quietLine,
  borderRadius: radii.R400,
  background: color.Surface.Container,
  color: color.Surface.OnContainer,
  font: 'inherit',
  textAlign: 'start',
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: color.Surface.ContainerHover },
    '&:focus-visible': {
      outline: `${borderWidth.B600} solid ${color.Primary.Main}`,
      outlineOffset: toRem(-1),
    },
  },
});

export const TitleRow = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: space.S200,
  minWidth: 0,
});

export const Title = style({ flex: '1 1 auto', minWidth: 0 });

export const Time = style({ flexShrink: 0 });

export const PreviewFailed = style({ color: color.Critical.Main });

export const Meta = style({
  display: 'flex',
  alignItems: 'center',
  gap: space.S200,
  minWidth: 0,
  marginBlockStart: space.S100,
});

/** How many turns it took and how many sub-agents it started, at the end of the line. */
export const Counts = style({
  display: 'flex',
  gap: space.S200,
  marginInlineStart: 'auto',
  flexShrink: 0,
});

export const Status = style({ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' });

// A small round mark in the status's color, before its word.
const dot = style({
  display: 'inline-block',
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

/** The open sub-agent's turns, each the caller's task, the cards of what it started, then its reply. */
export const Thread = style({ display: 'flex', flexDirection: 'column', gap: space.S300 });

// What the run was asked keeps its line breaks and wraps anywhere.
export const Task = style({ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });

export const Reply = style({ minWidth: 0, overflowWrap: 'anywhere' });

export const Failure = style({ margin: 0, color: color.Critical.Main, overflowWrap: 'anywhere' });

export const NestedRuns = style({ display: 'flex', flexDirection: 'column', gap: space.S200 });

/** The label over the runs it started, between two quiet lines. */
export const Divider = style({
  display: 'flex',
  alignItems: 'center',
  gap: space.S200,
  margin: 0,
  selectors: {
    '&::before, &::after': { content: '""', flex: '1 1 0', borderBlockStart: quietLine },
  },
});
