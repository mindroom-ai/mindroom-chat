import { createVar, keyframes, style, styleVariants } from '@vanilla-extract/css';
import { color, config } from 'folds';
import * as approvals from '../approvals/ThreadApprovals.css';
import { touchTarget } from '../ui/styles/touchTarget';

// The bar's place in the dock's row, nearly all the room beside the typing strip; it goes above
// the strip when it would get less than 20rem. Given a fixed height while the jobs are listed, it lets the
// bar grow upward over the timeline instead of growing the footer.
export const Anchor = style({
  position: 'relative',
  zIndex: 1,
  flex: '1000 1 20rem',
  minWidth: 0,
  display: 'flex',
  flexFlow: 'column nowrap',
  justifyContent: 'flex-end',
  marginBlockEnd: config.space.S200,
});

// The bar's own width, not the screen's, decides what gives way: beside the Sub-agents panel the
// thread chips shrink to their icons, and on a phone only the time, Open and Stop stay on the right.
const panel = '(max-width: 46rem)';
const phone = '(max-width: 30rem)';
const hiddenOnPhone = { '@container': { [phone]: { display: 'none' } } };

// The columns every row shares: logo | text | calls | tokens | cost | time | Open and Stop.
const logoSize = createVar();
const gap = createVar();
const calls = createVar();
const tokens = createVar();
const cost = createVar();
const time = createVar();
const button = config.size.X500;
const actions = `calc(2 * ${button} + ${config.space.S100})`;

// The typing bar's size and material; the rows inside take no surface of their own. Listed jobs
// sit above the title line, though they follow the title in reading and focus order.
export const Bar = style([
  approvals.Bar,
  {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gridTemplateAreas: '"jobs jobs" "status action" "alert alert"',
    alignItems: 'center',
    columnGap: config.space.S300,
    rowGap: 0,
    margin: 0,
    padding: `${config.space.S100} ${config.space.S300}`,
    containerType: 'inline-size',
    fontSize: config.fontSize.T200,
    lineHeight: config.lineHeight.T200,
    fontVariantNumeric: 'tabular-nums',
    vars: {
      [logoSize]: config.size.X500,
      [gap]: config.space.S300,
      [calls]: '2.5rem',
      [tokens]: '3.25rem',
      [cost]: '3.5rem',
      [time]: '3.5rem',
    },
    '@container': {
      [panel]: {
        vars: { [gap]: config.space.S200, [calls]: '2rem', [tokens]: '3rem', [cost]: '3.25rem' },
      },
    },
  },
]);

const grid = {
  display: 'grid',
  alignItems: 'center',
  columnGap: gap,
  gridTemplateColumns: `${logoSize} minmax(0, 1fr) ${calls} ${tokens} ${cost} ${time} ${actions}`,
  '@container': {
    [phone]: { gridTemplateColumns: `${logoSize} minmax(0, 1fr) ${time} ${actions}` },
  },
} as const;

export const Status = style([
  approvals.BarStatus,
  // The title line is the rows' size, not the approval bar's.
  { gridArea: 'status', gap: config.space.S100, minHeight: config.size.X500, fontSize: 'inherit' },
]);

export const Action = style({ gridArea: 'action', display: 'flex', alignItems: 'center' });

// A button that reads as the bar's own text, ringed when the keyboard is on it.
const textButton = {
  padding: 0,
  border: 0,
  borderRadius: config.radii.R300,
  background: 'none',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'start',
  cursor: 'pointer',
} as const;
const keyboardRing = { outline: `2px solid ${color.Primary.Main}`, outlineOffset: 2 };

// Several jobs' title lists them when pressed: its icon in the logos' column, the count, the
// sub-agents' logos and what runs, then the chevron at its end.
export const Toggle = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: gap,
  flex: '1 1 auto',
  minWidth: 0,
  minHeight: config.size.X500,
  ...textButton,
  selectors: {
    '&:focus-visible': keyboardRing,
    // As tall as the bar to a finger, without growing the line; on a phone it is the way to the Stops.
    '&::after': {
      content: '""',
      position: 'absolute',
      insetBlock: `calc(-1 * ${config.space.S200})`,
      insetInline: 0,
    },
  },
  '@container': { [phone]: { gap: config.space.S200 } },
  // A finger gets 44 px.
  '@media': {
    '(pointer: coarse)': {
      selectors: {
        '&::after': {
          insetBlock: `min(calc(-1 * ${config.space.S200}), calc((100% - 44px) / 2))`,
        },
      },
    },
  },
});

// The title's icon sits in the logos' column; a phone leaves it out.
export const TitleIcon = style([
  { display: 'grid', placeItems: 'center', flex: 'none', inlineSize: logoSize },
  hiddenOnPhone,
]);

export const Title = style({
  flex: '0 1 auto',
  minWidth: '4rem',
  fontWeight: config.fontWeight.W600,
});

export const Chevron = style({
  display: 'grid',
  placeItems: 'center',
  flex: 'none',
  marginInlineStart: 'auto',
  inlineSize: button,
  blockSize: button,
  opacity: config.opacity.P300,
  selectors: { '[aria-expanded="true"] > &': { transform: 'rotate(180deg)' } },
});

// The room a focus ring needs inside the scrolling list, which clips what overflows it.
const ring = '3px';

// Several jobs list above the title, sub-agents then tools; many scroll inside the bar. A line
// sets the list off the title.
export const Jobs = style({
  gridArea: 'jobs',
  margin: `-${ring}`,
  marginBlockEnd: config.space.S100,
  padding: ring,
  paddingBlockEnd: config.space.S100,
  borderBlockEnd: `1px solid ${color.SurfaceVariant.ContainerLine}`,
  maxHeight: 'min(45vh, 22rem)',
  overflowY: 'auto',
});

export const JobList = style({ listStyle: 'none', margin: 0, padding: 0 });

// Over each group, its name and the names of the number columns, on the rows' grid.
export const GroupHeading = style([
  grid,
  {
    paddingBlock: `${config.space.S300} ${config.space.S100}`,
    selectors: { '&:first-child': { paddingBlockStart: config.space.S200 } },
  },
]);

export const GroupName = style({
  gridColumn: '1 / span 2',
  margin: 0,
  font: 'inherit',
  fontWeight: config.fontWeight.W600,
  opacity: config.opacity.P300,
});

export const ColumnName = style({ textAlign: 'end', opacity: config.opacity.P300 });

export const StatColumn = style([ColumnName, hiddenOnPhone]);

// The row's own background, which the status dot's ring takes so it never shows as a halo.
const rowBackground = createVar();
// One step of nesting: a nested job's logo and text move in by it; its columns stay.
const step = '1.75rem';

// One job on the shared grid, two lines high; a hairline sets each top-level job off the one
// before, while a nested job stays with its parent. On touch, rows stand apart for their Stops.
export const Job = style([
  grid,
  {
    position: 'relative',
    minHeight: '2.875rem',
    paddingBlock: config.space.S100,
    marginInline: `calc(-1 * ${config.space.S200})`,
    paddingInline: config.space.S200,
    borderRadius: config.radii.R300,
    vars: { [rowBackground]: color.SurfaceVariant.Container },
    selectors: {
      '&:hover': {
        background: color.SurfaceVariant.ContainerHover,
        vars: { [rowBackground]: color.SurfaceVariant.ContainerHover },
      },
      '&[data-job-depth="0"] + &[data-job-depth="0"]::after': {
        content: '""',
        position: 'absolute',
        insetBlockStart: 0,
        insetInline: config.space.S200,
        borderBlockStart: `1px solid ${color.SurfaceVariant.ContainerLine}`,
      },
      '&:hover::after, &:hover + &::after': { display: 'none' },
    },
    '@media': { '(pointer: coarse)': { minHeight: '3rem' } },
  },
]);

// A nested job: smaller logo, moved in by its depth, with an elbow from its parent's logo.
export const Nested = style({
  vars: { [logoSize]: '1.25rem' },
  paddingInlineStart: `calc(${config.space.S200} + var(--job-depth) * ${step})`,
  selectors: {
    '&::before': {
      content: '""',
      position: 'absolute',
      insetBlockStart: 0,
      blockSize: '50%',
      insetInlineStart: `calc(${config.space.S200} + (var(--job-depth) - 1) * ${step} + 0.875rem)`,
      inlineSize: '0.625rem',
      borderInlineStart: `1px solid ${color.Secondary.ContainerLine}`,
      borderBlockEnd: `1px solid ${color.Secondary.ContainerLine}`,
      borderEndStartRadius: '6px',
    },
  },
});

// The run's model, the agent's picture or a terminal, on a tile that stands out from the bar.
export const Logo = style({
  position: 'relative',
  display: 'grid',
  placeItems: 'center',
  flex: 'none',
  inlineSize: logoSize,
  blockSize: logoSize,
  borderRadius: config.radii.R300,
  background: color.Surface.Container,
  color: color.Surface.OnContainer,
  boxShadow: `inset 0 0 0 1px ${color.SurfaceVariant.ContainerLine}`,
});

// Several jobs' title stacks the first sub-agents' logos, each over the one before; on a phone,
// what needs approval takes their place.
export const Stack = style({
  display: 'inline-flex',
  flex: 'none',
  vars: { [logoSize]: '1.25rem' },
  '@container': {
    [phone]: { selectors: { [`${Toggle}:has([data-needs-approval]) &`]: { display: 'none' } } },
  },
});

export const StackedLogo = style({
  boxShadow: `inset 0 0 0 1px ${color.SurfaceVariant.ContainerLine}, 0 0 0 2px ${color.SurfaceVariant.Container}`,
  selectors: { '& + &': { marginInlineStart: '-0.375rem' } },
});

const pulse = keyframes({ '50%': { opacity: 0.45 } });
const statusDot = {
  position: 'absolute',
  insetBlockEnd: '-3px',
  insetInlineEnd: '-3px',
  inlineSize: '0.625rem',
  blockSize: '0.625rem',
  borderRadius: '50%',
  border: `2px solid ${rowBackground}`,
} as const;

export const Dot = styleVariants({
  running: [
    statusDot,
    {
      background: color.Success.Main,
      '@media': {
        '(prefers-reduced-motion: no-preference)': {
          animation: `${pulse} 2s ease-in-out infinite`,
        },
      },
    },
  ],
  waiting: [statusDot, { background: color.Warning.Main }],
  stopping: [statusDot, { background: color.Critical.Main }],
  finished: [statusDot, { background: color.SurfaceVariant.OnContainer }],
});

// The text column: the task as the headline, then who, on what, doing what, on one muted line.
export const JobText = style({
  display: 'grid',
  minWidth: 0,
  overflow: 'clip',
  overflowClipMargin: 4,
});

const line = {
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  minWidth: 0,
  whiteSpace: 'nowrap',
} as const;

export const Headline = style({
  ...line,
  fontSize: config.fontSize.T300,
  lineHeight: config.lineHeight.T300,
});

export const Detail = style(line);

const truncate = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
} as const;

// The task (or the tool's name) is the row's one bold text; it gives way after nothing else.
export const Task = style({ ...truncate, flex: '1 1 0', fontWeight: config.fontWeight.W600 });

// The agent's name gives way only once what it does is gone.
export const Name = style({
  ...truncate,
  flex: '0 1 auto',
  minWidth: '3rem',
  maxWidth: '11rem',
  opacity: config.opacity.P300,
  '@container': { [panel]: { maxWidth: '7rem' } },
});

export const Model = style([{ flex: 'none', opacity: config.opacity.P300 }, hiddenOnPhone]);

// What it does now: the tool's name, then its arguments, muted, in the app's code font.
export const Activity = style({ ...truncate, flex: '1 1 0' });

export const Preview = style({ fontFamily: 'var(--font-mono)', opacity: config.opacity.P300 });

// At most one pill a row, at the end of its headline; on a phone it is its icon.
const pill = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  flex: 'none',
  marginInlineStart: 'auto',
  blockSize: config.lineHeight.T200,
  paddingInline: config.space.S200,
  borderRadius: config.radii.Pill,
  fontSize: config.fontSize.T200,
  lineHeight: config.lineHeight.T200,
  fontWeight: config.fontWeight.W400,
} as const;

export const Pill = styleVariants({
  waiting: [
    pill,
    {
      background: color.Warning.Container,
      color: color.Warning.OnContainer,
      '@container': {
        [phone]: { paddingInline: 0, inlineSize: config.lineHeight.T200, justifyContent: 'center' },
      },
    },
  ],
  stopping: [
    pill,
    { background: color.Critical.Container, color: color.Critical.OnContainer },
    hiddenOnPhone,
  ],
});

export const PillText = style(hiddenOnPhone);

export const PillIcon = style({ display: 'none', '@container': { [phone]: { display: 'grid' } } });

// A job of another thread names it; pressing it shows that thread. Beside the Sub-agents panel
// it is its icon, and its title names the thread.
export const ThreadChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  flex: '0 1 auto',
  minWidth: '3rem',
  maxWidth: '11rem',
  marginInlineStart: 'auto',
  ...textButton,
  color: color.Primary.Main,
  selectors: { '&:focus-visible': keyboardRing },
  '@container': { [panel]: { minWidth: 0 } },
});

export const ThreadTitle = style({
  ...truncate,
  selectors: { [`${ThreadChip}:hover > &`]: { textDecoration: 'underline' } },
  '@container': { [panel]: { display: 'none' } },
});

// The number columns: bare numbers, end-aligned on the row's middle with its time and buttons.
export const Num = style({ textAlign: 'end', whiteSpace: 'nowrap', opacity: config.opacity.P300 });

export const Stat = style([Num, hiddenOnPhone]);

export const Actions = style({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: config.space.S100,
});

// Open, Stop and Stop all: one family of 28 px icon buttons on the bar's own material, Stop
// turning red under the pointer. To a finger each reaches 44 px.
const iconButton = {
  display: 'grid',
  placeItems: 'center',
  flex: 'none',
  inlineSize: button,
  blockSize: button,
  ...textButton,
  selectors: {
    '&:hover': { background: color.SurfaceVariant.ContainerActive },
    '&:focus-visible': keyboardRing,
  },
} as const;

export const IconButton = style([touchTarget('8px'), iconButton]);

const stopHover = { background: color.Critical.Container, color: color.Critical.Main };

export const StopButton = style([
  touchTarget('8px'),
  {
    ...iconButton,
    selectors: { ...iconButton.selectors, '&:hover': stopHover },
    '@media': {
      '(forced-colors: active)': { outline: '1px solid CanvasText', outlineOffset: '-1px' },
    },
  },
]);

export const StopAll = style([
  touchTarget('8px'),
  {
    ...textButton,
    display: 'inline-flex',
    alignItems: 'center',
    gap: config.space.S100,
    flex: 'none',
    blockSize: button,
    paddingInline: config.space.S200,
    whiteSpace: 'nowrap',
    selectors: { '&:hover': stopHover, '&:focus-visible': keyboardRing },
  },
]);

// "Stopping…" in Stop's place: a spinner in its slot, its words for screen readers.
export const Stopping = style({
  display: 'grid',
  placeItems: 'center',
  flex: 'none',
  inlineSize: button,
  blockSize: button,
});

// After several jobs' title: what runs, muted, then what needs approval at full contrast. On a
// phone only the latter stays.
export const Summary = style([
  { ...truncate, flex: '0 1000 auto', opacity: config.opacity.P300 },
  hiddenOnPhone,
]);

export const SummaryWaiting = style({
  ...truncate,
  flex: '0 1000 auto',
  color: color.Warning.Main,
  selectors: { [`${Summary} + &::before`]: { content: '"· "' } },
  '@container': { [phone]: { selectors: { [`${Summary} + &::before`]: { content: 'none' } } } },
});

// The time keeps its width as it ticks.
export const Elapsed = style({
  textAlign: 'end',
  whiteSpace: 'nowrap',
  opacity: config.opacity.P300,
});

export const VisuallyHidden = style({
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
});

export const Alert = style({ gridArea: 'alert', paddingBlock: config.space.S100 });
