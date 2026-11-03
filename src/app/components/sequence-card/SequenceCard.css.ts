import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, config } from 'folds';

const CORNER = config.radii.R400;

/** Cards in a run share borders; only the first and last round their outer corners. */
export const SequenceCard = recipe({
  base: [
    DefaultReset,
    {
      // Every card draws its top edge, which doubles as the divider under the card before it;
      // only the last card of a run draws a bottom edge.
      border: `${config.borderWidth.B300} solid`,
      borderBottomStyle: 'none',
      borderColor: 'var(--mr-container-line, transparent)',
      selectors: {
        '&:first-child, :not(&) + &': {
          borderStartStartRadius: CORNER,
          borderStartEndRadius: CORNER,
        },
        '&:last-child, &:not(:has(+ &))': {
          borderBottomStyle: 'solid',
          borderEndStartRadius: CORNER,
          borderEndEndRadius: CORNER,
        },
      },
    },
  ],
  variants: {
    outlined: {
      false: { borderColor: 'transparent' },
    },
  },
});
