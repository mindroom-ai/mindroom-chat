import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';
import { transition } from '../../styles/transition';

export const CategoryState = style({
  padding: `${config.space.S200} ${config.space.S300}`,
  color: color.Background.OnContainer,
});

export const RecentlyOpenedPanel = style({
  position: 'relative',
  display: 'flex',
  flex: 'none',
  flexDirection: 'column',
  padding: config.space.S200,
  paddingRight: 0,
  borderTop: `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`,
  backgroundColor: color.Background.Container,
  selectors: {
    '&[data-collapsed=true]': {
      maxHeight: 'none',
    },
  },
});

export const RecentlyOpenedResizeHandle = style({
  position: 'absolute',
  zIndex: 1,
  top: '-6px',
  right: 0,
  left: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '12px',
  cursor: 'row-resize',
  touchAction: 'none',
  userSelect: 'none',
  ':focus-visible': {
    outline: `${config.borderWidth.B300} solid ${color.Primary.Main}`,
    outlineOffset: `calc(-1 * ${config.borderWidth.B300})`,
  },
});

export const RecentlyOpenedResizeGrip = style({
  width: config.space.S700,
  height: '3px',
  borderRadius: '999px',
  backgroundColor: color.Background.ContainerLine,
  transition: transition(['background-color']),
  selectors: {
    [`.${RecentlyOpenedResizeHandle}:hover &, .${RecentlyOpenedResizeHandle}:focus-visible &`]: {
      backgroundColor: color.Primary.Main,
    },
  },
});

export const RecentlyOpenedCategory = style({
  display: 'flex',
  flex: '1 1 auto',
  flexDirection: 'column',
  minHeight: 0,
});

export const RecentlyOpenedList = style({
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  paddingRight: config.space.S100,
  paddingBottom: config.space.S200,
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
  transition: transition(['opacity']),

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
