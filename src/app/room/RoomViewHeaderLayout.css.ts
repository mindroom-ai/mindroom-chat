import { style } from '@vanilla-extract/css';
import { toRem } from 'folds';
import { shortViewport } from '../ui/styles/shortViewport';

export const Header = style({
  '@media': { [shortViewport]: { selectors: { '&&': { height: toRem(44) } } } },
});

export const Topic = style({
  '@media': { [shortViewport]: { selectors: { '&&': { display: 'none' } } } },
});
