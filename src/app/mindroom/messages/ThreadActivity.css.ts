import { style, styleVariants } from '@vanilla-extract/css';
import { color, config, DefaultReset, toRem } from 'folds';

export const Activity = style([
  DefaultReset,
  {
    marginTop: config.space.S100,
    marginBottom: config.space.S100,
    minWidth: 0,
  },
]);

// A quiet line inside the message, not a box: icon tile, bold title, muted detail.
export const Line = style([
  DefaultReset,
  {
    display: 'inline-flex',
    alignItems: 'center',
    gap: config.space.S200,
    maxWidth: '100%',
    padding: `${toRem(2)} ${config.space.S100} ${toRem(2)} 0`,
    border: 'none',
    borderRadius: config.radii.R300,
    background: 'none',
    color: color.Surface.OnContainer,
    font: 'inherit',
    fontSize: toRem(13),
    textAlign: 'start',
    cursor: 'pointer',
    selectors: {
      '&:focus-visible': {
        outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
        outlineOffset: toRem(2),
      },
    },
  },
]);

const IconTile = style({
  flexShrink: 0,
  display: 'grid',
  placeItems: 'center',
  width: toRem(22),
  height: toRem(22),
  borderRadius: toRem(7),
});

export const Icon = styleVariants({
  neutral: [
    IconTile,
    { backgroundColor: color.SurfaceVariant.Container, color: color.SurfaceVariant.OnContainer },
  ],
  success: [
    IconTile,
    { backgroundColor: color.Success.Container, color: color.Success.OnContainer },
  ],
  critical: [
    IconTile,
    { backgroundColor: color.Critical.Container, color: color.Critical.OnContainer },
  ],
});

export const Title = style({
  flexShrink: 0,
  fontWeight: config.fontWeight.W600,
  whiteSpace: 'nowrap',
});

export const Detail = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  opacity: config.opacity.P400,
});

export const Chevron = style({ flexShrink: 0, opacity: config.opacity.P400 });

export const Panel = style({
  marginTop: config.space.S200,
  borderRadius: config.radii.R400,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  overflow: 'hidden',
});

// Rows in the panel are separated by quiet dividers, not nested boxes.
export const Row = style({
  display: 'grid',
  gridTemplateColumns: `${toRem(22)} minmax(0, 1fr)`,
  columnGap: toRem(10),
  rowGap: toRem(4),
  alignItems: 'start',
  padding: `${toRem(10)} ${toRem(14)} ${toRem(10)} ${toRem(12)}`,
  selectors: {
    '& + &': {
      borderTop: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
    },
  },
});

export const RowBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: toRem(2),
  minWidth: 0,
});

export const RowName = style({
  fontFamily: 'var(--font-mono)',
  fontSize: toRem(13),
  fontWeight: config.fontWeight.W600,
  lineHeight: toRem(22),
});

export const RowText = style({
  fontSize: toRem(13),
  minWidth: 0,
});

export const Result = style([
  DefaultReset,
  {
    display: 'block',
    width: '100%',
    padding: 0,
    border: 'none',
    background: 'none',
    color: 'inherit',
    fontFamily: 'var(--font-mono)',
    fontSize: toRem(12),
    lineHeight: 1.5,
    textAlign: 'start',
    opacity: config.opacity.P400,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    selectors: {
      '&[aria-expanded="true"]': { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
      '&:focus-visible': {
        outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
        borderRadius: config.radii.R300,
      },
    },
  },
]);
