import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

export const SwipeShell = style({
  position: 'relative',
  display: 'flex',
  flex: '1 1 auto',
  width: '100%',
  height: '100%',
  minHeight: 0,
  minWidth: 0,
  overflow: 'hidden',
  overscrollBehaviorX: 'contain',
});

export const SwipePane = style({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  width: '100%',
  height: '100%',
  backgroundColor: color.Surface.Container,
});

export const ActivePane = style({
  zIndex: 2,
  transform: 'translate3d(var(--mindroom-room-thread-swipe-active-x, 0px), 0, 0)',
  willChange: 'transform',
});

export const PreviewPane = style({
  zIndex: 1,
  pointerEvents: 'none',
  transform: 'translate3d(var(--mindroom-room-thread-swipe-preview-x, 0px), 0, 0)',
  willChange: 'transform',
});

export const PreviewPaneLeft = style({
  transform: 'translate3d(var(--mindroom-room-thread-swipe-preview-x, -100%), 0, 0)',
});

export const PreviewPaneRight = style({
  transform: 'translate3d(var(--mindroom-room-thread-swipe-preview-x, 100%), 0, 0)',
});

export const SwipePaneTransition = style({
  transition: 'transform 180ms cubic-bezier(0.2, 0, 0, 1)',
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      transitionDuration: '1ms',
    },
  },
});

export const PreviewChrome = style({
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  height: '100%',
  backgroundColor: color.Surface.Container,
});

export const PreviewHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S300,
  minHeight: '3.5rem',
  padding: `0 ${config.space.S400}`,
  borderBottom: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.Surface.Container,
});

export const PreviewAvatar = style({
  display: 'grid',
  placeItems: 'center',
  flexShrink: 0,
  width: '2rem',
  height: '2rem',
  borderRadius: '50%',
  backgroundColor: color.Primary.Container,
  color: color.Primary.OnContainer,
  fontWeight: 600,
});

export const PreviewTitleColumn = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  gap: config.space.S100,
});

export const PreviewBody = style({
  flex: '1 1 auto',
  minHeight: 0,
  padding: config.space.S400,
  backgroundColor: color.Surface.Container,
});

export const PreviewLine = style({
  height: '0.75rem',
  maxWidth: '100%',
  marginBottom: config.space.S300,
  borderRadius: config.radii.R300,
  backgroundColor: color.SurfaceVariant.Container,
});

export const PreviewLineShort = style({
  width: '45%',
});

export const PreviewLineMedium = style({
  width: '68%',
});

export const PreviewLineLong = style({
  width: '88%',
});
