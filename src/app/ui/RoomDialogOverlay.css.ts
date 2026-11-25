import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { glassDenseOverBackdrop } from './styles/Glass.css';
import { touchTarget } from './styles/touchTarget';

// Room-header dialog trigger button; the count sits on its corner (40 px + 4 px gap -> 44x44 touch target).
export const Trigger = style([{ position: 'relative' }, touchTarget('2px')]);

export const Count = style({
  position: 'absolute',
  insetBlockStart: toRem(2),
  insetInlineEnd: toRem(2),
  minWidth: toRem(14),
  height: toRem(14),
  paddingBlock: 0,
  paddingInline: toRem(3),
  borderRadius: config.radii.Pill,
  backgroundColor: color.Secondary.Main,
  color: color.Secondary.OnMain,
  fontSize: toRem(9),
  fontWeight: config.fontWeight.W600,
  lineHeight: toRem(14),
  textAlign: 'center',
  pointerEvents: 'none',
});

/** The horizontal center of the room view, in viewport pixels; RoomDialogOverlay sets it. */
export const ROOM_VIEW_CENTER = '--mr-room-view-center';

// Dense text: the glass is tinted nearly opaque so the room behind does not show through.
export const Dialog = style([
  glassDenseOverBackdrop,
  {
    width: `min(${toRem(540)}, 100vw)`,
    maxWidth: '100vw',
    maxHeight: `min(${toRem(700)}, 85vh, 100dvh)`,
    overflow: 'hidden',
    // Over the room view rather than the whole window, but never past the window's edges.
    translate: `clamp((100% - 100vw) / 2, var(${ROOM_VIEW_CENTER}, 50vw) - 50vw, (100vw - 100%) / 2) 0`,
  },
]);

export const Header = style({
  gap: config.space.S200,
  paddingInline: config.space.S400,
  borderBlockEnd: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
});

export const HeaderCount = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: toRem(22),
  height: toRem(20),
  paddingInline: toRem(7),
  borderRadius: config.radii.Pill,
  backgroundColor: `color-mix(in srgb, ${color.Surface.OnContainer} 8%, transparent)`,
  color: color.Surface.OnContainer,
  fontSize: config.fontSize.T200,
  fontWeight: config.fontWeight.W600,
  lineHeight: 1,
  flexShrink: 0,
});

export const Content = style({
  paddingBlock: config.space.S300,
  paddingInline: config.space.S400,
  minWidth: 0,
  '@media': { '(max-width: 380px)': { paddingInline: config.space.S300 } },
});

export const Empty = style({
  paddingBlock: config.space.S500,
  paddingInline: config.space.S300,
  alignItems: 'center',
  textAlign: 'center',
});
