import { style } from '@vanilla-extract/css';
import { DefaultReset, config, toRem } from 'folds';
import * as disclosure from '../../ui/styles/MessageDisclosure.css';

export const Cards = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: config.space.S200,
  marginBlockStart: config.space.S200,
});

export const Card = style([
  DefaultReset,
  disclosure.Surface,
  {
    width: 'auto',
    maxWidth: toRem(280),
    display: 'flex',
    alignItems: 'center',
    gap: config.space.S300,
    padding: `${config.space.S200} ${config.space.S300}`,
    textAlign: 'start',
    selectors: {
      'button&': { cursor: 'pointer' },
      '&:focus-visible': { outline: `${config.borderWidth.B600} solid currentColor` },
    },
  },
]);

export const Text = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });
