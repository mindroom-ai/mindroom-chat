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
// selecting text or opening the callout a long press opens, and keyboard focus on it shows.
const FOCUS_RING = config.borderWidth.B400;
const HANDLE = `${Frame} [data-call-window-handle]`;
// WebKit reads only the prefixed form of user-select.
const NO_SELECT = { userSelect: 'none', WebkitUserSelect: 'none' } as const;
const DRAGS_ONLY = { ...NO_SELECT, touchAction: 'none', WebkitTouchCallout: 'none' } as const;
globalStyle(HANDLE, DRAGS_ONLY);
globalStyle(`${HANDLE}:focus-visible`, {
  outline: `${FOCUS_RING} solid ${color.Primary.Main}`,
  outlineOffset: `calc(-1 * ${FOCUS_RING})`,
});

// Each grip reaches `outside` px past the border and a few px in, so the title bar's buttons keep
// nearly all of their area; a corner grip is a square that the edge grips stop short of. A finger
// gets thicker grips that reach further out than a mouse pointer's.
type GripSize = { outside: number; thickness: number; corner: number };
const MOUSE_GRIPS: GripSize = { outside: 6, thickness: 10, corner: 16 };
const TOUCH_GRIPS: GripSize = { outside: 10, thickness: 20, corner: 28 };

// The window is placed by coordinates, so an east grip widens it to the right in every reading
// direction: the grips sit on physical sides.
const physical = (side: 'left' | 'right', offset: string): StyleRule =>
  // eslint-disable-next-line no-restricted-syntax -- the grips follow the window's physical coordinates.
  side === 'left' ? { left: offset } : { right: offset };

/** Where each grip sits at one size. */
const gripPlaces = ({ outside, thickness, corner }: GripSize): Record<ResizeEdge, StyleRule> => {
  const out = toRem(-outside);
  const across = { insetInline: toRem(corner - outside), height: toRem(thickness) };
  const along = { insetBlock: toRem(corner - outside), width: toRem(thickness) };
  const square = { width: toRem(corner), height: toRem(corner) };
  const [start, end] = [physical('left', out), physical('right', out)];
  return {
    n: { top: out, ...across },
    ne: { top: out, ...end, ...square },
    e: { ...end, ...along },
    se: { bottom: out, ...end, ...square },
    s: { bottom: out, ...across },
    sw: { bottom: out, ...start, ...square },
    w: { ...start, ...along },
    nw: { top: out, ...start, ...square },
  };
};

const mouse = gripPlaces(MOUSE_GRIPS);
const touch = gripPlaces(TOUCH_GRIPS);

const grip = (pointer: string, edge: ResizeEdge): StyleRule => ({
  ...mouse[edge],
  position: 'absolute',
  cursor: pointer,
  '@media': { '(pointer: coarse)': touch[edge] },
  touchAction: 'none',
});

export const Edge = styleVariants<Record<ResizeEdge, StyleRule>>({
  n: grip('ns-resize', 'n'),
  ne: grip('nesw-resize', 'ne'),
  e: grip('ew-resize', 'e'),
  se: grip('nwse-resize', 'se'),
  s: grip('ns-resize', 's'),
  sw: grip('nesw-resize', 'sw'),
  w: grip('ew-resize', 'w'),
  nw: grip('nwse-resize', 'nw'),
});
