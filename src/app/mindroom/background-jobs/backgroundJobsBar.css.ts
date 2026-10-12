import { style } from '@vanilla-extract/css';
import * as approvals from '../messages/ThreadApprovals.css';

// The approval bar's composer-bar look, wrapping when a view has many jobs.
export const Bar = style([approvals.Bar, { flexWrap: 'wrap' }]);

export const Status = style([approvals.BarStatus]);

// Many jobs scroll inside the bar, so it never grows past the screen; Stop all stays outside the list.
export const Items = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  maxHeight: 'min(30vh, 160px)',
  overflowY: 'auto',
});

export const Item = style([
  approvals.Chip,
  {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    padding: '2px 4px 2px 10px',
    cursor: 'default',
    maxWidth: '100%',
    minWidth: 0,
  },
]);

// A long tool name is cut short, so its cancel button stays in view; the full name is its title.
export const Label = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: 0,
});

export const Chip = style([approvals.Chip]);
