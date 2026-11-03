import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

// Fills the resizable members panel around it, which owns the width.
export const MembersDrawer = style({
  inlineSize: '100%',
  blockSize: '100%',
  minHeight: 0,
  borderInlineStart: `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`,
});

export const MembersHeaderControl = style({
  padding: `0 ${config.space.S200}`,
});

export const MembersHeaderCount = style({
  fontWeight: config.fontWeight.W600,
});

export const MembersHeaderInvited = style({
  minWidth: 0,
});

export const MemberDrawerContentBase = style({
  position: 'relative',
  minHeight: 0,
});

export const MembersGroupLabel = style({
  padding: `${config.space.S200} ${config.space.S300} ${config.space.S100}`,
});

export const DrawerVirtualItem = style({
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  padding: `0 ${config.space.S100}`,
});

export const JoinRequestItem = style({
  padding: config.space.S200,
  borderRadius: config.radii.R400,
});

export const JoinRequestMessage = style({
  whiteSpace: 'pre-wrap',
});

export const JoinRequestActions = style({
  paddingTop: config.space.S100,
});
