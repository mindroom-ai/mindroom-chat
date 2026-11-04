import { globalStyle, style } from '@vanilla-extract/css';
import { config, toRem } from 'folds';

// No box of its own, so the page inside lays out like any other page of the client.
export const ConnectionsRoute = style({ display: 'contents' });

// The page passes its card no class; give it the padding of the cards in Settings, at a readable width.
globalStyle(`${ConnectionsRoute} [data-sequence-card]`, {
  padding: config.space.S300,
  maxWidth: toRem(640),
});
