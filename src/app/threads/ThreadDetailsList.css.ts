import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

export const ThreadDetail = style({
  selectors: {
    '&:empty': { display: 'none' },
    '&:not(:empty) ~ &:not(:empty)': {
      borderBlockStart: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
      paddingBlockStart: config.space.S200,
      marginBlockStart: config.space.S200,
    },
  },
});
