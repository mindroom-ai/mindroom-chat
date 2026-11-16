import { keyframes, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { glow } from './glow';

const turnBack = keyframes({ to: { transform: 'rotate(-360deg)' } });
const breathe = keyframes({
  '50%': { color: color.Warning.MainLine, filter: glow(color.Warning.Main) },
});
const spread = keyframes({
  from: { opacity: 0.9, transform: 'scale(1)' },
  to: { opacity: 0, transform: 'scale(2.4)' },
});

export const Fold = style([DefaultReset, { display: 'inline-flex' }]);

// Grey and faint with no box at rest, so the top of a reply stays quiet; colored while a call runs
// or waits for approval.
export const Cog = style([
  DefaultReset,
  {
    display: 'inline-flex',
    alignItems: 'center',
    gap: toRem(4),
    minBlockSize: toRem(22),
    paddingBlock: toRem(2),
    paddingInline: config.space.S100,
    marginInlineStart: `calc(${config.space.S100} * -1)`,
    border: 'none',
    borderRadius: config.radii.R300,
    background: 'none',
    color: color.Surface.OnContainer,
    opacity: config.opacity.P400,
    font: 'inherit',
    fontSize: toRem(12),
    fontVariantNumeric: 'tabular-nums',
    cursor: 'pointer',
    selectors: {
      '&[aria-expanded="true"]': { opacity: 1 },
      [`${Fold}[data-state="running"] &`]: { color: color.Primary.Main, opacity: 1 },
      [`${Fold}[data-state="waiting"] &`]: { color: color.Warning.Main, opacity: 1 },
      '&:focus-visible': {
        opacity: 1,
        outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
        outlineOffset: toRem(1),
      },
    },
    '@media': {
      '(pointer: coarse)': { minBlockSize: toRem(32) },
      '(hover: hover)': {
        selectors: {
          '&:hover': { opacity: 1, backgroundColor: color.SurfaceVariant.ContainerHover },
        },
      },
      '(prefers-reduced-motion: no-preference)': {
        transition: 'opacity 150ms ease, color 300ms ease, scale 120ms ease',
        selectors: { '&:active': { scale: '0.93' } },
      },
    },
  },
]);

// The gear and its light turn as one: slowly backwards while a call runs, against the comet, and
// by one of the gear's six teeth under the pointer.
export const CogIcon = style({
  position: 'relative',
  display: 'flex',
  flexShrink: 0,
  fontSize: toRem(14),
  '@media': {
    '(prefers-reduced-motion: no-preference)': {
      transition: 'rotate 550ms cubic-bezier(0.34, 1.56, 0.64, 1)',
      selectors: {
        [`${Fold}[data-state="running"] &`]: { animation: `${turnBack} 7s linear infinite` },
      },
    },
    '(hover: hover) and (prefers-reduced-motion: no-preference)': {
      selectors: { [`${Cog}:hover &`]: { rotate: '60deg' } },
    },
  },
});

// Dim while a call runs, so the comet on its outline stands out; its glow comes and goes while one
// waits for approval. Under the pointer it lights up.
export const CogGear = style({
  '@media': {
    '(prefers-reduced-motion: no-preference)': {
      transition: 'opacity 300ms ease, color 300ms ease, filter 300ms ease',
      selectors: {
        [`${Fold}[data-state="running"] &`]: { opacity: 0.42 },
        [`${Fold}[data-state="waiting"] &`]: {
          animation: `${breathe} 2.4s ease-in-out infinite`,
        },
      },
    },
    '(hover: hover)': {
      selectors: {
        [`${Fold} ${Cog}:hover &`]: {
          color: color.Primary.MainLine,
          filter: glow(color.Primary.Main),
          opacity: 1,
          animation: 'none',
        },
        [`${Fold}[data-state="waiting"] ${Cog}:hover &`]: {
          color: color.Warning.MainLine,
          filter: glow(color.Warning.Main),
        },
      },
    },
  },
});

// A click sheds the gear's outline, which grows and fades.
export const CogRipple = style({
  stroke: color.Primary.Main,
  strokeWidth: '1.3',
  strokeLinejoin: 'round',
  transformOrigin: '12px 12px',
  animation: `${spread} 650ms cubic-bezier(0.2, 0.7, 0.3, 1) both`,
  selectors: { [`${Fold}[data-state="waiting"] &`]: { stroke: color.Warning.Main } },
});
