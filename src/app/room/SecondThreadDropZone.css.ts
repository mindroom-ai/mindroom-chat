import { keyframes, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const fadeIn = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });

/**
 * Where a thread card's drag drops into the second column: the room's end edge, as wide as the
 * second column is (or would be), never wider than the room.
 */
export const DropZone = style({
  position: 'absolute',
  insetBlock: 0,
  insetInlineEnd: 0,
  maxWidth: '100%',
  zIndex: 10,
  boxSizing: 'border-box',
  padding: config.space.S200,
  display: 'flex',
  animation: `${fadeIn} 150ms ease-out`,
  '@media': {
    '(prefers-reduced-motion: reduce)': { animation: 'none' },
  },
});

/** The zone's tinted area, which lights up while the drag is over it. */
export const DropArea = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: config.space.S300,
  borderRadius: config.radii.R400,
  border: `${config.borderWidth.B600} dashed color-mix(in srgb, ${color.Primary.Main} 55%, transparent)`,
  backgroundColor: `color-mix(in srgb, ${color.Primary.Container} 55%, transparent)`,
  color: color.Primary.OnContainer,
  backdropFilter: 'blur(2px)',
  textAlign: 'center',
  pointerEvents: 'none',
  transition: 'background-color 150ms ease-out, border-color 150ms ease-out',
  selectors: {
    [`${DropZone}[data-over] &`]: {
      borderColor: color.Primary.Main,
      backgroundColor: `color-mix(in srgb, ${color.Primary.Container} 85%, transparent)`,
    },
  },
  '@media': {
    '(prefers-reduced-motion: reduce)': { transition: 'none' },
  },
});

export const DropIcon = style({ width: toRem(32), height: toRem(32) });
