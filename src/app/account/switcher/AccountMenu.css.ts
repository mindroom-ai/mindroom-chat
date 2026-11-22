import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const MenuSurface = style({
  inlineSize: toRem(272),
  maxInlineSize: 'calc(100vw - 5rem)',
  maxBlockSize:
    'calc(100dvh - 1rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});

export const MenuBody = style({
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minBlockSize: 0,
});

export const MenuScrollBody = style({
  flex: '1 1 auto',
  minBlockSize: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
});

export const Divider = style({
  flexShrink: 0,
});

export const HeaderCard = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  paddingBlock: `${config.space.S400} ${toRem(13)}`,
  paddingInline: toRem(14),
  gap: toRem(4),
});

export const HeaderName = style({
  maxInlineSize: '100%',
  marginBlockStart: config.space.S100,
});

export const HeaderUserId = style({
  maxInlineSize: '100%',
});

export const SettingsPill = style({
  marginBlockStart: toRem(7),
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: toRem(7),
  maxInlineSize: '100%',
  paddingBlock: toRem(6),
  paddingInline: toRem(14),
  borderRadius: config.radii.Pill,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.Surface.OnContainer,
  font: 'inherit',
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    '&:active': {
      backgroundColor: color.SurfaceVariant.ContainerActive,
    },
    '&:focus-visible': {
      outline: `${config.borderWidth.B400} solid ${color.Primary.Main}`,
      outlineOffset: toRem(1),
    },
  },
});

export const AccountWell = style({
  margin: config.space.S200,
  borderRadius: config.radii.R400,
  backgroundColor: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  overflow: 'hidden',
});

export const AccountWellHead = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S200,
  paddingBlock: `${toRem(7)} ${toRem(4)}`,
  paddingInline: toRem(10),
});

export const WellHeading = style({
  fontSize: toRem(11),
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
});

export const ManageButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  border: 0,
  borderRadius: config.radii.R300,
  paddingBlock: toRem(2),
  paddingInline: toRem(6),
  marginInlineEnd: toRem(-6),
  backgroundColor: 'transparent',
  color: color.SurfaceVariant.OnContainer,
  opacity: config.opacity.P300,
  font: 'inherit',
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      opacity: 1,
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    '&:active': {
      opacity: 1,
      backgroundColor: color.SurfaceVariant.ContainerActive,
    },
    '&:focus-visible': {
      opacity: 1,
      outline: `${config.borderWidth.B400} solid ${color.Primary.Main}`,
      outlineOffset: 0,
    },
  },
});

export const AccountWellList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: toRem(2),
  paddingBlock: `${toRem(2)} ${toRem(5)}`,
  paddingInline: config.space.S100,
});

export const AccountRow = style({
  selectors: {
    '&&': {
      blockSize: 'auto',
      minBlockSize: toRem(42),
      paddingBlock: toRem(5),
      paddingInline: toRem(7),
    },
  },
});

export const TextColumn = style({
  minInlineSize: 0,
  flexGrow: 1,
  textAlign: 'start',
});

export const SplitFooter = style({
  flexShrink: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  alignItems: 'stretch',
});

export const SplitFooterButton = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: toRem(6),
  minInlineSize: 0,
  minBlockSize: toRem(38),
  paddingBlock: toRem(8),
  paddingInline: config.space.S200,
  border: 0,
  backgroundColor: 'transparent',
  color: color.Surface.OnContainer,
  font: 'inherit',
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      backgroundColor: color.Surface.ContainerHover,
    },
    '&:active': {
      backgroundColor: color.Surface.ContainerActive,
    },
    '&:focus-visible': {
      outline: `${config.borderWidth.B400} solid ${color.Primary.Main}`,
      outlineOffset: `-${config.borderWidth.B400}`,
    },
  },
});

export const FooterLabel = style({
  minInlineSize: 0,
  whiteSpace: 'normal',
  overflowWrap: 'break-word',
  lineHeight: 1.25,
  textAlign: 'start',
});

export const SplitFooterSignOut = style({
  borderInlineStart: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  color: color.Critical.Main,
  selectors: {
    '&:hover': {
      backgroundColor: color.Critical.Container,
      color: color.Critical.OnContainer,
    },
    '&:active': {
      backgroundColor: color.Critical.ContainerActive,
      color: color.Critical.OnContainer,
    },
    '&:focus-visible': {
      outline: `${config.borderWidth.B400} solid ${color.Critical.Main}`,
      outlineOffset: `-${config.borderWidth.B400}`,
    },
  },
});

export const IconShrink = style({
  flexShrink: 0,
});
