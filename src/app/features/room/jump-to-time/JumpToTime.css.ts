import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

/**
 * A native select in the glass control look: an inset hairline instead of a border, so the
 * system picker still opens on phones.
 */
export const Picker = style({
  minInlineSize: 0,
  flexGrow: 1,
  blockSize: toRem(36),
  paddingInline: config.space.S200,
  color: color.SurfaceVariant.OnContainer,
  font: 'inherit',
  boxShadow: `inset 0 0 0 ${config.borderWidth.B300} ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  borderStyle: 'none',
  borderRadius: config.radii.R300,
  selectors: {
    '&:focus-visible': {
      outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
      outlineOffset: toRem(1),
    },
  },
});

/** The hour and minute pickers keep their width; the period picker sits after them. */
export const TimePicker = style({ flexGrow: 0, flexBasis: toRem(76) });
