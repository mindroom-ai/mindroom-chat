import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, config } from 'folds';

/** Cards in a run share borders; only the first and last round their outer corners. */







      borderColor: 'var(--mr-container-line, transparent)',





        },
        '&:last-child, &:not(:has(+ &))': {








    outlined: {
      false: { borderColor: 'transparent' },
    },
  },
});
