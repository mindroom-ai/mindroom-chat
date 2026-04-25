import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config } from 'folds';

export const PageNavSection = style({
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minHeight: 0,
});

export const Panel = style({
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  minHeight: 0,
  backgroundColor: color.SurfaceVariant.Container,
  borderTop: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

export const PanelHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  minHeight: '32px',
  padding: `0 ${config.space.S300}`,
  color: color.SurfaceVariant.OnContainer,
  borderBottom: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

export const PanelBody = style({
  flex: '1 1 auto',
  minHeight: 0,
});

export const PanelList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  padding: config.space.S200,
});

export const EmptyState = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100%',
  padding: config.space.S300,
  color: color.SurfaceVariant.OnContainer,
});

export const EntryButton = style([
  DefaultReset,
  {
    display: 'flex',
    flexDirection: 'column',
    gap: config.space.S100,
    width: '100%',
    minWidth: 0,
    padding: `${config.space.S200} ${config.space.S200}`,
    borderRadius: config.radii.R300,
    border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
    backgroundColor: color.SurfaceVariant.Container,
    color: color.SurfaceVariant.OnContainer,
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'background-color 120ms ease, border-color 120ms ease',
    ':hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    ':focus-visible': {
      outline: `${config.borderWidth.B300} solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
]);

export const EntryTopRow = style({
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: config.space.S100,
  minWidth: 0,
});

export const EntryRoomName = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const EntryTime = style({
  flexShrink: 0,
  whiteSpace: 'nowrap',
});

export const EntrySummary = style({
  minWidth: 0,
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  overflow: 'hidden',
  wordBreak: 'break-word',
});

export const Divider = style([
  DefaultReset,
  {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    height: '8px',
    cursor: 'row-resize',
    touchAction: 'none',
    userSelect: 'none',
    backgroundColor: color.Background.Container,
    ':focus-visible': {
      outline: `${config.borderWidth.B300} solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
]);

export const DividerActive = style({
  backgroundColor: color.Background.ContainerHover,
});

export const DividerHandle = style({
  width: '100%',
  maxWidth: '40px',
  height: '2px',
  borderRadius: '999px',
  backgroundColor: color.SurfaceVariant.ContainerLine,
});

export const DividerToggle = style([
  DefaultReset,
  {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
    gap: config.space.S200,
    width: '100%',
    height: '44px',
    padding: `0 ${config.space.S300}`,
    cursor: 'pointer',
    touchAction: 'manipulation',
    backgroundColor: color.Background.Container,
    color: color.SurfaceVariant.OnContainer,
    ':hover': {
      backgroundColor: color.Background.ContainerHover,
    },
    ':focus-visible': {
      outline: `${config.borderWidth.B300} solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
]);

export const DividerToggleHandle = style({
  width: '24px',
  flexShrink: 0,
});

export const PanelHeaderButton = style([
  DefaultReset,
  {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    minHeight: '32px',
    padding: `0 ${config.space.S300}`,
    color: color.SurfaceVariant.OnContainer,
    cursor: 'pointer',
    ':hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    ':focus-visible': {
      outline: `${config.borderWidth.B300} solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
]);
