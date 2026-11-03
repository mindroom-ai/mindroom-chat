import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config } from 'folds';











  DefaultReset,
  {
    paddingInline: config.space.S200,









    minHeight: 0,
    overflow: 'hidden',
    display: 'flex',



    touchAction: 'none',
  },
]);









    transition: 'transform 100ms ease-out',
    selectors: {
      '&[data-gesture="true"]': {
        transition: 'none',
      },
    },
  },
]);
