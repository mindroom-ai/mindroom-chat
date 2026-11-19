import { style } from '@vanilla-extract/css';
import { toRem } from 'folds';
import { shortViewport } from '../ui/styles/shortViewport';

export const Header = style({
  '@media': { [shortViewport]: { selectors: { '&&': { height: toRem(44) } } } },
});

// On a phone the open thread's rows take the header (ThreadContextBanner): edge to edge and as
// tall as its row and the thread's whole title need, on short screens too.
export const ThreadHeader = style({
  selectors: { '&&': { display: 'block', height: 'auto', padding: 0 } },
});

export const Topic = style({
  '@media': { [shortViewport]: { selectors: { '&&': { display: 'none' } } } },
});
