import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

// A pill with the emoji (or custom emoji image) and the count; tinted while the user's own
// reaction is among them.













    font: 'inherit',
    selectors: {
      '&[aria-pressed=true]': {
        backgroundColor: color.Primary.Container,
        borderColor: color.Primary.ContainerLine,
        color: color.Primary.OnContainer,
      },
      '&:hover, &:focus-visible': { backgroundColor: color.SurfaceVariant.ContainerHover },
      '&:disabled': { cursor: 'default' },
    },
  },
]);

export const ReactionImg = style({
  height: toRem(18),
  width: 'auto',
  objectFit: 'contain',
});

export const ReactionText = style({
  lineHeight: 1,
  maxWidth: toRem(160),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
