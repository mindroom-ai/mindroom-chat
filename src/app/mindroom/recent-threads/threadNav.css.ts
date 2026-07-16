import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

export const CategoryState = style({
  padding: `${config.space.S200} ${config.space.S300}`,
  color: color.Background.OnContainer,
});

export const EntrySummary = style({
  minWidth: 0,
});

export const EntryMeta = style({
  flexShrink: 0,
  color: color.Background.OnContainer,
});

export const EntryUnreadDot = style({
  width: '6px',
  height: '6px',
  flexShrink: 0,
  borderRadius: '999px',
  backgroundColor: color.Primary.Main,
});

export const EntryPinButtonPinned = style({
  color: color.Primary.Main,
});

export const EntryTooltip = style({
  padding: config.space.S300,
});

export const EntryTooltipDetails = style({
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr)',
  gap: `${config.space.S100} ${config.space.S300}`,
  alignItems: 'baseline',
});
