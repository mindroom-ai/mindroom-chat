import { keyframes, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

const turn = keyframes({ to: { transform: 'rotate(360deg)' } });

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
        transition: 'opacity 150ms ease, color 300ms ease',
      },
    },
  },
]);

export const CogIcon = style({
  flexShrink: 0,
  fontSize: toRem(14),
  '@media': {
    '(prefers-reduced-motion: no-preference)': {
      selectors: {
        [`${Fold}[data-state="running"] &`]: { animation: `${turn} 2.4s linear infinite` },
      },
    },
  },
});
