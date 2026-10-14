import { style } from '@vanilla-extract/css';
import { config } from 'folds';
import * as approvals from '../messages/ThreadApprovals.css';

// The typing bar's size: the status and its stop control on one row, several jobs' chips below.
export const Bar = style([
  approvals.Bar,
  {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    columnGap: config.space.S300,
    rowGap: config.space.S100,
    padding: `${config.space.S100} ${config.space.S300}`,
  },
]);

// As tall as the typing bar's 24px ✕, also when no Stop is shown.
export const Status = style([approvals.BarStatus, { gap: config.space.S300, minHeight: 24 }]);

// Many jobs scroll inside the bar, so it never grows past the screen; Stop all stays outside the list.
export const Items = style({
  gridColumn: '1 / -1',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
  maxHeight: 'min(30vh, 160px)',
  overflowY: 'auto',
  paddingBlockEnd: config.space.S100,
});

export const Item = style([
  approvals.Chip,
  {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    paddingInlineStart: 10,
    cursor: 'default',
    maxWidth: '100%',
    minWidth: 0,
  },
]);

// "Stopping…" in place of the ✕, inside the chip's padding.
export const ItemStatus = style({ paddingInlineEnd: 10, opacity: config.opacity.P400 });

// A long tool name is cut short in its chip, so its ✕ stays in view; the full text is its title.
export const Label = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
});

export const Alert = style({ gridColumn: '1 / -1' });
