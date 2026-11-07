import { style } from '@vanilla-extract/css';

/** Beside the rail the page's wrapper draws no box: the page is the row's item itself. */
export const PassThrough = style({ display: 'contents' });

/** On phones the page fills what the top bar leaves, as the row's page did. */
export const PhonePage = style({
  flexGrow: 1,
  minBlockSize: 0,
  display: 'flex',
  // The drawer slides over it: nothing inside, however high its z-index, rises above the drawer.
  isolation: 'isolate',
  overflow: 'hidden',
});
