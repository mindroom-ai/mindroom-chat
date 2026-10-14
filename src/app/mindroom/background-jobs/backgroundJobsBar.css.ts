import { style } from '@vanilla-extract/css';
import { config } from 'folds';
import * as approvals from '../messages/ThreadApprovals.css';

// The typing bar's size and material; the rows inside take no surface of their own.
export const Bar = style([
  approvals.Bar,
  {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 0,
    padding: `${config.space.S100} ${config.space.S300}`,
  },
]);

// One line, as tall as the typing bar's ✕ and a Stop: a label that gives way, and its action at the end.
export const Row = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S300,
  minHeight: '1.5rem',
  minWidth: 0,
});

export const Status = style([approvals.BarStatus, { flexGrow: 1, gap: config.space.S300 }]);

// The room a focus ring needs inside the scrolling list, which clips what overflows it.
const ring = '3px';

// Several jobs list under the title's text, past its icon; many scroll inside the bar.
export const Jobs = style({
  listStyle: 'none',
  margin: `-${ring}`,
  padding: ring,
  paddingInlineStart: `calc(${ring} + ${config.size.X50} + ${config.space.S300})`,
  maxHeight: 'min(30vh, 160px)',
  overflowY: 'auto',
});

// On touch, a row's Stop stands apart from the next one, since a stop cannot be undone.
export const Job = style([Row, { '@media': { '(pointer: coarse)': { minHeight: '2.5rem' } } }]);

// A long tool name and its status both give way, so its Stop stays in view; the full text is its title.
export const Label = style({ flexGrow: 1, minWidth: 0 });

export const Muted = style({ minWidth: 0, opacity: config.opacity.P300 });

// "Stopping…" in a Stop's place ends where the Stop's text does, inside the button's padding.
export const Stopping = style([Muted, { flexShrink: 0, paddingInlineEnd: config.space.S300 }]);

// Without fills, Stop keeps an edge in forced colors, as the glass controls do.
export const Action = style({
  '@media': {
    '(forced-colors: active)': { outline: '1px solid CanvasText', outlineOffset: '-1px' },
  },
});

export const Alert = style({ paddingBlock: config.space.S100 });
