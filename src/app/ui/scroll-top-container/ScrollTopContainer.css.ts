import { globalStyle, style } from '@vanilla-extract/css';

// A full-width strip that centers its button; only the button takes pointer input, so the
// strip never blocks the content under it. The caller's style sets how far down it floats.
export const ScrollTopContainer = style({
  position: 'absolute',
  insetInline: 0,
  zIndex: 3,
  display: 'flex',
  justifyContent: 'center',
  pointerEvents: 'none',
});

globalStyle(`${ScrollTopContainer} > *`, { pointerEvents: 'auto' });
