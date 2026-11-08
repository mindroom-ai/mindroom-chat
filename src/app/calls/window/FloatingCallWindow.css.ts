import { globalStyle, style, styleVariants, type StyleRule } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import type { ResizeEdge } from './callWindowGeometry';

// Above the page and its side panels, one under the incoming-call ring (1000 in
// IncomingCalls.css.ts); folds draws its overlays, the settings dialog among them, at 9999.
const WINDOW_LAYER = 999;
const GLIDE = '160ms ease';
const { Background } = color;

export const Frame = style({
  position: 'fixed',
  zIndex: WINDOW_LAYER,
  // A change that is not a drag (Minimize, Expand, a keyboard step, a bar dropping into its
  // corner) glides to the new box; the pointer leads a drag.
  transition: ['left', 'top', 'width', 'height'].map((name) => `${name} ${GLIDE}`).join(', '),
  selectors: { '&[data-dragging]': { transition: 'none' } },
  '@media': { '(prefers-reduced-motion: reduce)': { transition: 'none' } },
});

// The call view fills the box, which gives it the call panel's surface lifted off the page.
export const Box = style({
  display: 'flex',
  flexFlow: 'column nowrap',
  inlineSize: '100%',
  blockSize: '100%',
  // The border is drawn inside the placed box, so the window is exactly the stored size.
  boxSizing: 'border-box',
  border: `${config.borderWidth.B300} solid ${Background.ContainerLine}`,
  borderRadius: config.radii.R400,
  // The rounded corners clip the call view's square ones.
  overflow: 'hidden',
  boxShadow: config.shadow.E400,
  backgroundColor: Background.Container,
  color: Background.OnContainer,
});

// The call view's title bar moves the window: a touch on it drags instead of scrolling the page,
// and keyboard focus on it shows.
const FOCUS_RING = config.borderWidth.B400;
globalStyle(`${Frame} [data-call-window-handle]`, { touchAction: 'none' });
globalStyle(`${Frame} [data-call-window-handle]:focus-visible`, {
  outline: `${FOCUS_RING} solid ${color.Primary.Main}`,
  outlineOffset: `calc(-1 * ${FOCUS_RING})`,
});

// Each grip reaches OUTSIDE px past the border and a few px in, so the title bar's buttons keep
// nearly all of their area; a corner grip is a square that the edge grips stop short of.
const OUTSIDE = 6;
const THICKNESS = 10;
const CORNER = 16;
const out = toRem(-OUTSIDE);
const clear = toRem(CORNER - OUTSIDE);

const grip = (pointer: string, place: StyleRule): StyleRule => ({
  position: 'absolute',
  cursor: pointer,
  touchAction: 'none',
  ...place,
});

// The window is placed by coordinates, so an east grip widens it to the right in every reading
// direction: the grips sit on physical sides.
const physical = (side: 'left' | 'right'): StyleRule =>
  // eslint-disable-next-line no-restricted-syntax -- the grips follow the window's physical coordinates.
  side === 'left' ? { left: out } : { right: out };

const across = { insetInline: clear, height: toRem(THICKNESS) };
const along = { insetBlock: clear, width: toRem(THICKNESS) };
const corner = { width: toRem(CORNER), height: toRem(CORNER) };

export const Edge = styleVariants<Record<ResizeEdge, StyleRule>>({
  n: grip('ns-resize', { top: out, ...across }),
  ne: grip('nesw-resize', { top: out, ...physical('right'), ...corner }),
  e: grip('ew-resize', { ...physical('right'), ...along }),
  se: grip('nwse-resize', { bottom: out, ...physical('right'), ...corner }),
  s: grip('ns-resize', { bottom: out, ...across }),
  sw: grip('nesw-resize', { bottom: out, ...physical('left'), ...corner }),
  w: grip('ew-resize', { ...physical('left'), ...along }),
  nw: grip('nwse-resize', { top: out, ...physical('left'), ...corner }),
});
