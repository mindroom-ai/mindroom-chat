import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const SearchInput = style({
  width: '100%',
  boxSizing: 'border-box',
  font: 'inherit',
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.Surface.OnContainer,
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '-1px',
    },
  },
});

export const List = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  maxHeight: toRem(320),
  overflowY: 'auto',
  minHeight: 0,
});

export const RoomRow = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: config.space.S100,
  width: '100%',
  border: 'none',
  borderRadius: config.radii.R300,
  background: 'transparent',
  color: color.Surface.OnContainer,
  font: 'inherit',
  textAlign: 'start',
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  cursor: 'pointer',
  selectors: {
    '&:hover, &:focus-visible': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
  },
});

export const RoomRowActive = style({
  backgroundColor: color.SurfaceVariant.ContainerActive,
});

export const RoomTitle = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  minWidth: 0,
});

export const AgentWarning = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  color: color.Warning.Main,
  paddingInlineStart: config.space.S500,
});

export const EmptyState = style({
  paddingBlock: config.space.S400,
  textAlign: 'center',
});
