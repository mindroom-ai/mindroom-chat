import { globalStyle, style, styleVariants } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { Panel as SidePanelPanel } from '../ui/panels/SidePanel.css';
import { logoRing, logoSize } from './RunLogo.css';

const { space, radii, borderWidth } = config;
const quietLine = `${borderWidth.B300} solid ${color.Surface.ContainerLine}`;

// It fills its column, and on phones the room's width, as the room's other side panels do.
export const Panel = style([SidePanelPanel, { flexGrow: 1, position: 'relative' }]);

/** Inert previous view (list or parent run) revealed under a dragged detail run on phones. */
export const UnderLayer = style({
  position: 'absolute',
  inset: 0,
  zIndex: 0,
  display: 'flex',
  flexDirection: 'column',
  minBlockSize: 0,
  backgroundColor: color.Background.Container,
  pointerEvents: 'none',
});

/** Active detail run wrapper that tracks the finger over `UnderLayer` on phones. */
export const DetailLayer = style({
  position: 'relative',
  flex: '1 1 auto',
  display: 'flex',
  flexDirection: 'column',
  inlineSize: '100%',
  minInlineSize: 0,
  minBlockSize: 0,
  backgroundColor: color.Background.Container,
  selectors: {
    // Only elevate into a stacking context while actively sliding over `UnderLayer`.
    '&[data-swiping]': { zIndex: 1 },
  },
});

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

const truncate = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
} as const;

/**
 * One run as the jobs bar shows a job: its logo beside its title, who and how it stands, and its
 * labelled line; the sub-agents it started under them, then what it used across the card.
 */
export const Card = style({
  display: 'grid',
  gridTemplateColumns: `${config.size.X500} minmax(0, 1fr)`,
  columnGap: space.S300,
  rowGap: 0,
  width: '100%',
  minWidth: 0,
  padding: `${space.S200} ${space.S300}`,
  border: quietLine,
  borderRadius: radii.R400,
  background: color.Surface.Container,
  color: color.Surface.OnContainer,
  font: 'inherit',
  textAlign: 'start',
  fontVariantNumeric: 'tabular-nums',
  cursor: 'pointer',
  vars: { [logoRing]: color.Surface.Container },
  selectors: {
    '&:hover': {
      background: color.Surface.ContainerHover,
      vars: { [logoRing]: color.Surface.ContainerHover },
    },
    '&:focus-visible': {
      outline: `${borderWidth.B600} solid ${color.Primary.Main}`,
      outlineOffset: toRem(-1),
    },
  },
});

export const CardLogo = style({ alignSelf: 'start', marginBlockStart: toRem(2) });

export const CardText = style({ display: 'grid', minWidth: 0, gap: toRem(1) });

export const Title = style({ minWidth: 0, fontWeight: config.fontWeight.W600 });

export const PreviewFailed = style({ color: color.Critical.Main });

/** Who and how it stands: the agent, the model, the status, and the turns at the end. */
export const Meta = style({
  display: 'flex',
  alignItems: 'center',
  gap: space.S200,
  minWidth: 0,
  whiteSpace: 'nowrap',
});

/** The agent's name, which gives way only once the model beside it has. */
export const AgentName = style({ ...truncate, flex: '0 1 auto', opacity: config.opacity.P300 });

/** The model the agent runs on; it shrinks before the name does. */
export const Model = style({ ...truncate, flex: '0 1000 auto', opacity: config.opacity.P300 });

/** The open run's model, before its status; a long one is cut short rather than wrapped. */
export const StandingModel = style({
  minWidth: 0,
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

/** How many turns it took, at the end of the line. */
export const Counts = style({
  marginInlineStart: 'auto',
  flexShrink: 0,
  opacity: config.opacity.P300,
});

export const Status = style({ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' });
globalStyle(`${Meta} > ${Status}`, { opacity: config.opacity.P300 });

/** A run that waits for approval says so in the warning's color, at full contrast (`LineLabel`). */
export const StatusLoud = style([Status, { color: color.Warning.MainLine }]);

/** The card's third line: its label, then the call, the text or the reason, cut short. */
export const Line = style({
  display: 'flex',
  alignItems: 'center',
  gap: space.S100,
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
});

const label = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: space.S100,
  flex: 'none',
  fontWeight: config.fontWeight.W600,
} as const;

/**
 * The label says what the line shows, in its word and its color: never by color alone. Each
 * color's line step, darker than its main on light palettes and lighter on dark ones, keeps small
 * bold text at 4.5:1 on the panel's surfaces in every palette.
 */
export const LineLabel = styleVariants({
  now: [label, { color: color.Success.MainLine }],
  approval: [label, { color: color.Warning.MainLine }],
  result: [label, { opacity: config.opacity.P300 }],
  ended: [label, { color: color.Critical.MainLine }],
});

export const LineMark = style({
  display: 'inline-grid',
  placeItems: 'center',
  inlineSize: toRem(12),
  fontWeight: config.fontWeight.W700,
});

/** A small dot before Now, as live as the logo's. */
export const Tick = style({
  inlineSize: toRem(6),
  blockSize: toRem(6),
  marginInline: toRem(3),
  borderRadius: radii.Pill,
  background: color.Success.Main,
});

export const LineText = style({ ...truncate, flex: '1 1 auto', opacity: config.opacity.P300 });

/** A call: its tool, then its arguments, in the code font, cut short as one. */
export const ToolCall = style({
  ...truncate,
  flex: '1 1 auto',
  fontFamily: 'var(--font-mono)',
  fontSize: toRem(11),
});

export const ToolName = style({ fontWeight: config.fontWeight.W600 });

export const ToolArgs = style({ opacity: config.opacity.P300 });

/** What the run used, each count left out while unknown, and its time at the end, across the card. */
export const Stats = style({
  gridColumn: '1 / -1',
  display: 'flex',
  alignItems: 'baseline',
  gap: space.S300,
  minWidth: 0,
  marginBlockStart: space.S100,
  paddingBlockStart: space.S100,
  borderBlockStart: quietLine,
  whiteSpace: 'nowrap',
});

export const StatsTime = style({ marginInlineStart: 'auto' });

/** A sub-agent the run started, under its text, on an elbow from it: logo, title, time, line. */
export const NestedRun = style({
  gridColumn: 2,
  position: 'relative',
  display: 'grid',
  gridTemplateColumns: `${toRem(20)} minmax(0, 1fr) auto`,
  columnGap: space.S200,
  rowGap: toRem(1),
  alignItems: 'center',
  marginBlockStart: space.S100,
  vars: { [logoSize]: toRem(20) },
  selectors: {
    '&::before': {
      content: '""',
      position: 'absolute',
      insetBlockStart: toRem(-2),
      insetInlineStart: toRem(-22),
      blockSize: toRem(12),
      inlineSize: toRem(14),
      borderInlineStart: `1px solid ${color.Secondary.ContainerLine}`,
      borderBlockEnd: `1px solid ${color.Secondary.ContainerLine}`,
      borderEndStartRadius: toRem(6),
    },
  },
});

export const NestedLogo = style({});

export const NestedTitle = style({ minWidth: 0, fontWeight: config.fontWeight.W600 });

export const NestedTime = style({ whiteSpace: 'nowrap' });

// Without the usage details a nested run at work has no line, and takes no row.
export const NestedLine = style({
  gridColumn: '2 / -1',
  display: 'grid',
  minWidth: 0,
  selectors: { '&:empty': { display: 'none' } },
});

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
  cancelled: [dot, { background: color.Critical.Main }],
  denied: [dot, { background: color.Critical.Main }],
  interrupted: [dot, { background: color.SurfaceVariant.OnContainer }],
});

/** The open sub-agent's turns, each the caller's task, the cards of what it started, then its reply. */
export const Thread = style({ display: 'flex', flexDirection: 'column', gap: space.S300 });

// What the run was asked keeps its line breaks and wraps anywhere.
export const Task = style({ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });

export const Reply = style({ minWidth: 0, overflowWrap: 'anywhere' });

export const Failure = style({ margin: 0, color: color.Critical.Main, overflowWrap: 'anywhere' });

/** Why a turn a restart cut short ended, in the neutral tone: MindRoom may continue it. */
export const Interruption = style({ margin: 0, overflowWrap: 'anywhere' });

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

const headerLine = `${borderWidth.B300} solid ${color.Background.ContainerLine}`;

/** The open run's header: its buttons stay at the top beside a title of two lines. */
export const RunHeader = style({
  alignItems: 'flex-start',
  vars: { [logoRing]: color.Background.Container },
});

export const HeaderLogo = style({ marginBlockStart: toRem(4) });

/** The run's title, at most two lines; the whole task is its tooltip. */
export const RunTitle = style({
  margin: 0,
  display: '-webkit-box',
  overflow: 'hidden',
  overflowWrap: 'anywhere',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
});

// Stop turns red under the pointer, as the jobs bar's does.
export const HeaderStop = style({
  selectors: {
    '&:hover': { background: color.Critical.Container, color: color.Critical.Main },
  },
  '@media': {
    '(forced-colors: active)': { outline: '1px solid CanvasText', outlineOffset: '-1px' },
  },
});

/** "Stopping…" in Stop's place: a spinner, its words for screen readers. */
export const HeaderStopping = style({
  display: 'grid',
  placeItems: 'center',
  flex: 'none',
  inlineSize: config.size.X400,
  blockSize: config.size.X400,
});

export const VisuallyHidden = style({
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
});

/** Under the header, a cell each for how the run stands, its calls, tokens and cost. */
// Its cells, three or four, share its width evenly.
export const Strip = style({
  flex: 'none',
  display: 'grid',
  gridAutoFlow: 'column',
  gridAutoColumns: 'minmax(0, 1fr)',
  margin: 0,
  borderBlockEnd: headerLine,
  fontVariantNumeric: 'tabular-nums',
});

export const StripCell = style({
  display: 'grid',
  gap: toRem(1),
  minWidth: 0,
  paddingBlock: space.S200,
  paddingInline: space.S200,
  selectors: {
    '&:first-child': { paddingInlineStart: space.S400 },
    '& + &': { borderInlineStart: headerLine },
  },
});

export const StripName = style({ margin: 0, fontSize: toRem(11), lineHeight: toRem(16) });

export const StripValue = style({
  margin: 0,
  fontWeight: config.fontWeight.W600,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

export const StripNote = style({ margin: 0, fontSize: toRem(11), lineHeight: toRem(16) });

/** While the run works, the call it makes now and how long it has run; while it waits, that call. */
export const NowLine = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: space.S200,
  minWidth: 0,
  paddingBlock: space.S100,
  paddingInline: space.S400,
  borderBlockEnd: headerLine,
  background: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  whiteSpace: 'nowrap',
});

export const NowTime = style({ flex: 'none', opacity: config.opacity.P300 });

/**
 * Without the usage details, the strip folds away under the header, a quiet line that opens it.
 * Its cells keep the strip's look, with the line above them.
 */
export const Usage = style({ flex: 'none', borderBlockEnd: headerLine });
globalStyle(`${Usage}[open] > ${Strip}`, { borderBlockStart: headerLine, borderBlockEnd: 0 });

export const UsageSummary = style({
  display: 'flex',
  alignItems: 'center',
  gap: space.S100,
  paddingBlock: space.S100,
  paddingInline: space.S400,
  fontSize: toRem(12),
  cursor: 'pointer',
  listStyle: 'none',
  selectors: {
    '&::-webkit-details-marker': { display: 'none' },
    '&:focus-visible': { outline: `2px solid ${color.Primary.Main}`, outlineOffset: -2 },
  },
});

/** The disclosure's chevron points to the reading end, and down while open. */
export const UsageChevron = style({
  flex: 'none',
  selectors: {
    '[dir=rtl] &': { transform: 'rotate(180deg)' },
    [`${Usage}[open] > summary &`]: { transform: 'rotate(90deg)' },
  },
  '@media': {
    '(prefers-reduced-motion: no-preference)': { transition: 'transform 150ms ease' },
  },
});

export const StopFailure = style({
  flex: 'none',
  paddingBlock: space.S100,
  paddingInline: space.S400,
  color: color.Critical.MainLine,
});
