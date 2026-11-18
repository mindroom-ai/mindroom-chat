import { keyframes, style, styleVariants } from '@vanilla-extract/css';
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
  },
]);

export const Status = style([
  approvals.BarStatus,
  { gridArea: 'status', gap: config.space.S300, minHeight: '1.5rem' },
]);

export const Action = style({ gridArea: 'action', display: 'flex' });

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

// Several jobs' title lists them when pressed; it reads as the title, with a chevron.
export const Toggle = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S300,
  minWidth: 0,
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

export const Chevron = style({
  flexShrink: 0,
  opacity: config.opacity.P300,
  selectors: { '[aria-expanded="true"] > &': { transform: 'rotate(180deg)' } },
});

// The room a focus ring needs inside the scrolling list, which clips what overflows it.
const ring = '3px';

// Under this width a row drops its model (the logo stays) and what its run used.
const narrow = 'screen and (max-width: 40rem)';
const hiddenWhenNarrow = { '@media': { [narrow]: { display: 'none' } } };

// Several jobs list above the title, sub-agents then tools; many scroll inside the bar.
export const Jobs = style({
  gridArea: 'jobs',
  margin: `-${ring}`,
  padding: ring,
  maxHeight: 'min(45vh, 20rem)',
  overflowY: 'auto',
});

export const JobList = style({ listStyle: 'none', margin: 0, padding: 0 });

// "Sub-agents · 5" over its group, when tools are listed too.
export const GroupHeading = style({
  margin: 0,
  paddingBlock: `${config.space.S200} ${config.space.S100}`,
  opacity: config.opacity.P300,
});

// One job: its logo, its two lines, which give way, then its time, Open and Stop, which end the
// line. On touch, a row's Stop stands apart from the next one, since a stop cannot be undone.
export const Job = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S300,
  minHeight: '1.5rem',
  minWidth: 0,
  paddingBlock: config.space.S100,
  '@media': { '(pointer: coarse)': { minHeight: '2.5rem' } },
});

export const JobText = style({
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  minWidth: 0,
});

export const JobLine = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  minWidth: 0,
  whiteSpace: 'nowrap',
});

// The agent's name gives way after the task does.
export const Name = style({ flex: '0 1 auto', minWidth: '3rem' });

export const ModelPill = style([{ flexShrink: 0, maxWidth: '10rem' }, hiddenWhenNarrow]);

export const Task = style({ flex: '0 1000 auto', minWidth: 0, opacity: config.opacity.P300 });

export const Pill = style({ flexShrink: 0 });

// What it does now: the tool's name, then its arguments in the code font, cut short.
export const Activity = style({
  flex: '0 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  fontSize: config.fontSize.T200,
});

export const Preview = style({
  fontFamily: 'monospace',
  opacity: config.opacity.P300,
});

export const Stats = style([
  { flexShrink: 0, marginInlineStart: 'auto', opacity: config.opacity.P300 },
  hiddenWhenNarrow,
]);

// The status dot's ring takes the bar's own surface, so it stands off the logo.
const statusDot = {
  position: 'absolute',
  insetBlockEnd: '-2px',
  insetInlineEnd: '-2px',
  width: '9px',
  height: '9px',
  borderRadius: '50%',
  border: `2px solid ${color.Surface.Container}`,
} as const;

const pulse = keyframes({ '50%': { opacity: 0.45 } });

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

// Several jobs' title stacks the first sub-agents' logos, each over the one before.
export const Stack = style({ display: 'inline-flex', flexShrink: 0 });

// The run's model, the agent's picture or a terminal, on a tile of the bar's variant surface.
export const Logo = style({
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  borderRadius: config.radii.R300,
  background: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  selectors: {
    [`${Stack} > &`]: { boxShadow: `0 0 0 1.5px ${color.Surface.Container}` },
    [`${Stack} > & + &`]: { marginInlineStart: '-5px' },
  },
});

export const Summary = style({ minWidth: 0, opacity: config.opacity.P300 });

export const SummaryWaiting = style({ color: color.Warning.Main });

// The time keeps its width as it ticks.
export const Elapsed = style({
  flexShrink: 0,
  fontVariantNumeric: 'tabular-nums',
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

// A text button that opens the Sub-agents panel or a thread, underlined to the pointer.
const panelLinkSelectors = {
  '&:hover': { textDecoration: 'underline' },
  '&:focus-visible': keyboardRing,
};

// A job of another thread names it; pressing it shows that thread.
export const ThreadChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  flex: '0 1 auto',
  minWidth: 0,
  maxWidth: '14rem',
  ...textButton,
  color: color.Primary.Main,
  selectors: panelLinkSelectors,
});

// Open, in a row before its Stop and beside one job's title: as wide as its word, the text before
// it giving way first. To a finger it reaches half the gap toward its neighbours.
export const Open = style([
  touchTarget('6px'),
  { flexShrink: 0, ...textButton, selectors: panelLinkSelectors },
]);

export const Muted = style({ minWidth: 0, opacity: config.opacity.P300 });

// "Stopping…" in a Stop's place ends where the Stop's text does, inside the button's padding.
export const Stopping = style([Muted, { flexShrink: 0, paddingInlineEnd: config.space.S300 }]);

// Without fills, Stop keeps an edge in forced colors, as the glass controls do. To a finger it is
// 44 px, and in the list of jobs as tall as its 40 px row.
export const Plain = style([
  touchTarget('22px'),
  touchTarget('22px', `${Job} `, { blockReach: '8px' }),
  {
    '@media': {
      '(forced-colors: active)': { outline: '1px solid CanvasText', outlineOffset: '-1px' },
    },
  },
]);

export const Alert = style({ gridArea: 'alert', paddingBlock: config.space.S100 });
