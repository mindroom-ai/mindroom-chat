import { globalStyle, style, styleVariants } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

const reducedMotion = '(prefers-reduced-motion: reduce)';

const cardBase = style({
  display: 'flex',
  flexDirection: 'column',
  gap: toRem(8),
  boxSizing: 'border-box',
  width: 'fit-content',
  minWidth: 0,
  maxWidth: `min(100%, ${toRem(480)})`,
  marginBlock: config.space.S100,
  paddingBlock: toRem(10),
  paddingInline: toRem(12),
  borderRadius: toRem(12),
  color: color.SurfaceVariant.OnContainer,
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
});

export const Card = styleVariants({
  warning: [
    cardBase,
    {
      border: `${config.borderWidth.B300} solid color-mix(in srgb, ${color.Warning.Main} 38%, ${color.SurfaceVariant.ContainerLine})`,
      backgroundColor: `color-mix(in srgb, ${color.Warning.Main} 8%, ${color.SurfaceVariant.Container})`,
    },
  ],
  danger: [
    cardBase,
    {
      border: `${config.borderWidth.B300} solid color-mix(in srgb, ${color.Critical.Main} 38%, ${color.SurfaceVariant.ContainerLine})`,
      backgroundColor: `color-mix(in srgb, ${color.Critical.Main} 8%, ${color.SurfaceVariant.Container})`,
    },
  ],
});

export const Top = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: toRem(9),
  minWidth: 0,
});

const iconTileBase = style({
  display: 'grid',
  placeItems: 'center',
  flexShrink: 0,
  inlineSize: toRem(22),
  blockSize: toRem(22),
  marginBlockStart: toRem(1),
  borderRadius: toRem(7),
});

export const IconTile = styleVariants({
  warning: [
    iconTileBase,
    {
      backgroundColor: `color-mix(in srgb, ${color.Warning.Main} 16%, transparent)`,
      color: color.Warning.OnContainer,
    },
  ],
  danger: [
    iconTileBase,
    {
      backgroundColor: `color-mix(in srgb, ${color.Critical.Main} 16%, transparent)`,
      color: color.Critical.OnContainer,
    },
  ],
});

export const Copy = style({
  display: 'flex',
  flexDirection: 'column',
  gap: toRem(2),
  flex: 1,
  minWidth: 0,
});

export const TitleRow = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: toRem(6),
  minWidth: 0,
});

export const Title = style({
  fontSize: toRem(13.5),
  fontWeight: config.fontWeight.W600,
  lineHeight: 1.35,
  color: color.SurfaceVariant.OnContainer,
});

const chipBase = style({
  display: 'inline-flex',
  alignItems: 'center',
  paddingBlock: toRem(1),
  paddingInline: toRem(6),
  borderRadius: config.radii.Pill,
  fontSize: toRem(11),
  fontWeight: config.fontWeight.W500,
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
});

export const Chip = styleVariants({
  warning: [
    chipBase,
    {
      backgroundColor: `color-mix(in srgb, ${color.Warning.Main} 14%, transparent)`,
      color: color.Warning.OnContainer,
    },
  ],
  danger: [
    chipBase,
    {
      backgroundColor: `color-mix(in srgb, ${color.Critical.Main} 14%, transparent)`,
      color: color.Critical.OnContainer,
    },
  ],
});

export const Summary = style({
  fontSize: toRem(13),
  lineHeight: 1.45,
  color: color.SurfaceVariant.OnContainer,
});

globalStyle(`${Summary} a:not([class])`, {
  color: 'inherit',
  textDecoration: 'underline',
  textUnderlineOffset: toRem(2),
});

globalStyle(`${Summary} a:focus-visible`, {
  outline: `${toRem(2)} solid ${color.Primary.Main}`,
  outlineOffset: toRem(2),
  borderRadius: config.radii.R300,
});

export const Footer = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: toRem(8),
  paddingBlockStart: toRem(2),
  paddingInlineStart: toRem(31),
});

export const ActionButton = style([
  DefaultReset,
  {
    display: 'inline-flex',
    alignItems: 'center',
    gap: toRem(5),
    paddingBlock: toRem(5),
    paddingInline: toRem(11),
    borderRadius: toRem(8),
    border: `${config.borderWidth.B300} solid transparent`,
    backgroundColor: color.Primary.Main,
    color: color.Primary.OnMain,
    fontSize: toRem(12.5),
    fontWeight: config.fontWeight.W600,
    lineHeight: 1.35,
    cursor: 'pointer',
    transition: 'background-color 120ms ease, transform 80ms ease',
    selectors: {
      '&:hover:not(:disabled)': {
        backgroundColor: color.Primary.MainHover,
      },
      '&:active:not(:disabled)': {
        backgroundColor: color.Primary.MainActive,
        transform: 'scale(0.97)',
      },
      '&:focus-visible': {
        outline: `${toRem(2)} solid ${color.Primary.Main}`,
        outlineOffset: toRem(2),
      },
      '&:disabled': {
        opacity: config.opacity.Disabled,
        cursor: 'default',
      },
    },
    '@media': {
      [reducedMotion]: {
        transition: 'none',
        selectors: { '&:active:not(:disabled)': { transform: 'none' } },
      },
    },
  },
]);

export const DetailsToggle = style([
  DefaultReset,
  {
    display: 'inline-flex',
    alignItems: 'center',
    gap: toRem(4),
    paddingBlock: toRem(3),
    paddingInline: toRem(6),
    borderRadius: toRem(6),
    backgroundColor: 'transparent',
    color: color.SurfaceVariant.OnContainer,
    fontSize: toRem(12),
    fontWeight: config.fontWeight.W500,
    lineHeight: 1.35,
    cursor: 'pointer',
    selectors: {
      '&:hover, &:focus-visible': {
        backgroundColor: `color-mix(in srgb, ${color.SurfaceVariant.OnContainer} 8%, transparent)`,
      },
      '&:focus-visible': {
        outline: `${toRem(2)} solid ${color.Primary.Main}`,
        outlineOffset: toRem(1),
      },
    },
  },
]);

export const DetailsDrawer = style({
  paddingInlineStart: toRem(31),
  minWidth: 0,
});

export const TechBox = style({
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr)',
  gap: `${toRem(3)} ${toRem(12)}`,
  margin: 0,
  paddingBlock: toRem(7),
  paddingInline: toRem(9),
  borderRadius: toRem(8),
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: `color-mix(in srgb, ${color.Surface.Container} 78%, transparent)`,
  color: color.Surface.OnContainer,
  fontFamily: 'var(--font-mono)',
  fontSize: toRem(11.5),
  lineHeight: 1.45,
  overflowWrap: 'anywhere',
});

export const TechKey = style({
  fontWeight: config.fontWeight.W500,
  whiteSpace: 'nowrap',
});

export const TechValue = style({
  margin: 0,
  minWidth: 0,
});

export const ErrorAlert = style({
  paddingInlineStart: toRem(31),
  color: color.Critical.OnContainer,
  fontSize: toRem(12),
});

export const Receipt = style({
  display: 'inline-flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
  width: 'fit-content',
  minWidth: 0,
  maxWidth: `min(100%, ${toRem(480)})`,
  marginBlock: config.space.S100,
  borderRadius: toRem(9),
  border: `${config.borderWidth.B300} solid color-mix(in srgb, ${color.Success.Main} 42%, ${color.SurfaceVariant.ContainerLine})`,
  backgroundColor: 'transparent',
  color: color.SurfaceVariant.OnContainer,
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
});

export const ReceiptButton = style([
  DefaultReset,
  {
    display: 'inline-flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: toRem(6),
    paddingBlock: toRem(5),
    paddingInline: toRem(10),
    borderRadius: toRem(8),
    backgroundColor: 'transparent',
    color: 'inherit',
    fontSize: toRem(12.5),
    lineHeight: 1.4,
    textAlign: 'start',
    cursor: 'pointer',
    selectors: {
      '&:hover': {
        backgroundColor: `color-mix(in srgb, ${color.SurfaceVariant.Container} 55%, transparent)`,
      },
      '&:focus-visible': {
        outline: `${toRem(2)} solid ${color.Primary.Main}`,
        outlineOffset: toRem(2),
      },
    },
  },
]);

export const ReceiptCheck = style({
  display: 'inline-flex',
  alignItems: 'center',
  color: color.Success.OnContainer,
  flexShrink: 0,
});

export const ReceiptStatus = style({
  fontWeight: config.fontWeight.W600,
});

export const ReceiptSep = style({
  opacity: config.opacity.P300,
});

export const ReceiptTitle = style({
  opacity: config.opacity.P400,
});

export const ReceiptChevron = style({
  display: 'inline-flex',
  alignItems: 'center',
  opacity: config.opacity.P400,
  marginInlineStart: toRem(2),
});

export const ReceiptBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: toRem(6),
  paddingBlockStart: toRem(6),
  paddingBlockEnd: toRem(9),
  paddingInline: toRem(10),
  borderBlockStart: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

export const RestartSeam = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  marginBlock: toRem(6),
  minWidth: 0,
  fontSize: toRem(12),
  lineHeight: toRem(18),
  color: 'inherit',
  whiteSpace: 'normal',
});

export const RestartRuleStart = style({
  inlineSize: toRem(18),
  flexShrink: 0,
  blockSize: toRem(1),
  backgroundColor: color.Surface.ContainerLine,
});

export const RestartRuleEnd = style({
  flex: 1,
  minInlineSize: toRem(16),
  maxInlineSize: toRem(120),
  blockSize: toRem(1),
  backgroundColor: color.Surface.ContainerLine,
});

// Inherits MessageTextBody's opacity directly instead of compounding another P400 layer.
export const RestartLabel = style({
  overflowWrap: 'anywhere',
});
