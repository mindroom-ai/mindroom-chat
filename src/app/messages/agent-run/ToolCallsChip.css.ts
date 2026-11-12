import { keyframes, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

const appear = keyframes({ from: { opacity: 0, transform: 'translateY(0.3em)' } });
// A new call's icon opens its own space, so the label slides along instead of jumping.
const grow = keyframes({
  from: { width: 0, marginInlineEnd: toRem(-4), opacity: 0, transform: 'scale(0.3)' },
});
const ripple = keyframes({
  '0%': { opacity: 0.7, transform: 'scale(0.9)' },
  '100%': { opacity: 0, transform: 'scale(1.35)' },
});

export const Chip = style([
  DefaultReset,
  {
    marginBlock: config.space.S100,
    minWidth: 0,
    '@media': {
      '(prefers-reduced-motion: no-preference)': {
        selectors: { '&[data-live]': { animation: `${appear} 240ms ease-out both` } },
      },
    },
  },
]);

// Grey and quiet once the calls are done; tinted while one runs or waits for approval.
export const Button = style([
  DefaultReset,
  {
    display: 'inline-flex',
    alignItems: 'center',
    gap: config.space.S200,
    maxWidth: '100%',
    paddingBlock: toRem(3),
    paddingInlineStart: toRem(4),
    paddingInlineEnd: toRem(10),
    border: 'none',
    borderRadius: config.radii.Pill,
    backgroundColor: color.SurfaceVariant.Container,
    color: color.SurfaceVariant.OnContainer,
    font: 'inherit',
    fontSize: toRem(12.5),
    cursor: 'pointer',
    selectors: {
      [`${Chip}[data-state="running"] &`]: {
        backgroundColor: color.Primary.Container,
        color: color.Primary.OnContainer,
      },
      [`${Chip}[data-state="waiting"] &`]: {
        backgroundColor: color.Warning.Container,
        color: color.Warning.OnContainer,
      },
      '&:focus-visible': {
        outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
        outlineOffset: toRem(1),
      },
    },
    '@media': {
      '(hover: hover)': {
        selectors: { '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover } },
      },
      '(prefers-reduced-motion: no-preference)': {
        transition: 'background-color 350ms ease, color 350ms ease',
      },
    },
  },
]);

export const Icons = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(4),
});

export const Tile = style({
  position: 'relative',
  flexShrink: 0,
  display: 'grid',
  placeItems: 'center',
  width: toRem(20),
  height: toRem(20),
  borderRadius: '50%',
  backgroundColor: `color-mix(in srgb, ${color.Surface.Container} 70%, transparent)`,
  fontSize: toRem(12),
  selectors: {
    '&[data-state="running"]': { backgroundColor: color.Surface.Container },
    '&[data-state="running"]::after': {
      content: '""',
      position: 'absolute',
      inset: toRem(-2),
      borderRadius: '50%',
      border: `${toRem(1.5)} solid currentColor`,
      opacity: 0,
    },
    '&[data-state="denied"]': {
      backgroundColor: color.Critical.Container,
      color: color.Critical.OnContainer,
    },
  },
  '@media': {
    '(prefers-reduced-motion: no-preference)': {
      selectors: {
        '&[data-new]': { animation: `${grow} 380ms cubic-bezier(0.3, 1.5, 0.5, 1) both` },
        '&[data-state="running"]::after': { animation: `${ripple} 1.4s ease-out infinite` },
      },
    },
  },
});

export const More = style({
  fontSize: toRem(11.5),
  fontVariantNumeric: 'tabular-nums',
  opacity: config.opacity.P400,
});

export const Label = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

// Points along the text while closed (right, or left in right-to-left), down while open.
export const Chevron = style({
  flexShrink: 0,
  opacity: config.opacity.P400,
  selectors: {
    '[dir=rtl] &': { transform: 'rotate(180deg)' },
    [`${Button}[aria-expanded="true"] &`]: { transform: 'rotate(90deg)' },
  },
  '@media': {
    '(prefers-reduced-motion: no-preference)': { transition: 'transform 150ms ease' },
  },
});
