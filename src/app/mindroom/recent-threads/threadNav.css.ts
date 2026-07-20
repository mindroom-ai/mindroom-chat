import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

export const CategoryState = style({
  padding: `${config.space.S200} ${config.space.S300}`,
  color: color.Background.OnContainer,
});

export const RecentlyOpenedPanel = style({
  display: 'flex',
  flex: '0 1 auto',
  flexDirection: 'column',
  minHeight: 0,
  maxHeight: '45%',
  padding: config.space.S200,
  paddingRight: 0,
  borderTop: `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`,
  backgroundColor: color.Background.Container,
});

export const RecentlyOpenedCategory = style({
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
});

export const RecentlyOpenedList = style({
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  paddingRight: config.space.S100,
});

export const Entry = style({
  position: 'relative',
});

export const EntrySummary = style({
  minWidth: 0,
});

export const EntryUnreadDot = style({
  width: '6px',
  height: '6px',
  flexShrink: 0,
  borderRadius: '999px',
  backgroundColor: color.Primary.Main,
});

export const EntryActions = style({
  position: 'absolute',
  inset: `0 0 0 auto`,
  paddingLeft: config.space.S600,
  opacity: 0,
  visibility: 'hidden',
  pointerEvents: 'none',
  borderRadius: 'inherit',
  background: `linear-gradient(to right, transparent, ${color.Background.ContainerHover} 45%)`,
  transition: 'opacity 120ms ease',

  selectors: {
    [`.${Entry}:hover &, .${Entry}:focus-within &`]: {
      opacity: 1,
      visibility: 'visible',
      pointerEvents: 'auto',
    },
    [`.${Entry}[aria-selected='true'] &`]: {
      background: `linear-gradient(to right, transparent, ${color.Background.ContainerActive} 45%)`,
    },
  },
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
