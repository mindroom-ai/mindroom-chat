import { style } from '@vanilla-extract/css';
import { DefaultReset } from 'folds';

// Layers over an image or video thumbnail: the media fills the base, overlays sit on top.
const fillParent = { width: '100%', height: '100%' } as const;

export const RelativeBase = style([DefaultReset, { ...fillParent, position: 'relative' }]);

/** An overlay pinned to every edge of the base, so it covers exactly the media. */
export const AbsoluteContainer = style([DefaultReset, { position: 'absolute', inset: 0 }]);

export const Blur = style([DefaultReset, { filter: 'blur(44px)' }]);
