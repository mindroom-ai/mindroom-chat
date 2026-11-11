import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';
import * as approvals from '../approvals/ThreadApprovals.css';
import { touchTarget } from '../ui/styles/touchTarget';

// The bar's place in the footer. Given a fixed height while the jobs are listed, it lets the bar
// grow upward over the timeline instead of growing the footer.
export const Anchor = style({
  position: 'relative',
  zIndex: 1,
  flex: '0 0 auto',
  display: 'flex',
  flexFlow: 'column nowrap',
  justifyContent: 'flex-end',
  margin: `0 ${config.space.S400} ${config.space.S200}`,
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
    '&::after': { content: '""', position: 'absolute', inset: `calc(-1 * ${config.space.S200}) 0` },
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

// Several jobs list above the title, in line with its text past the icon; many scroll inside the bar.
export const Jobs = style({
  gridArea: 'jobs',
  listStyle: 'none',
  margin: `-${ring}`,
  padding: ring,
  paddingInlineStart: `calc(${ring} + ${config.size.X50} + ${config.space.S300})`,
  maxHeight: 'min(30vh, 160px)',
  overflowY: 'auto',
});

// One job: its name and status give way, and its Stop ends the line, as tall as the typing bar's
// ✕. On touch, a row's Stop stands apart from the next one, since a stop cannot be undone.
export const Job = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S300,
  minHeight: '1.5rem',
  minWidth: 0,
  '@media': { '(pointer: coarse)': { minHeight: '2.5rem' } },
});

// A long tool name and its status both give way, so its Stop stays in view; the full text is its title.
export const Label = style({ flexGrow: 1, minWidth: 0 });

// A text button that opens the Sub-agents panel, underlined to the pointer.
const panelLinkSelectors = {
  '&:hover': { textDecoration: 'underline' },
  '&:focus-visible': keyboardRing,
};

// A sub-agent's name in its row opens the panel: the row's text still.
export const LabelButton = style([
  Label,
  { display: 'flex', ...textButton, selectors: panelLinkSelectors },
]);

// Beside one sub-agent job's title, the way to the panel: as wide as its words, the title giving
// way first. To a finger it reaches half the gap toward its neighbours.
export const TitleLink = style([
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
