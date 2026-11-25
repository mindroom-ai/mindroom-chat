import { globalStyle, keyframes, style } from '@vanilla-extract/css';
import { color, config } from 'folds';
import { PageSurface } from '../page/floatingCards.css';

const expandGhostEnter = keyframes({
  from: { opacity: 0, transform: 'scale(0.992)' },
  to: { opacity: 1, transform: 'scale(1)' },
});

export const Panel = style({
  vars: { '--mr-panel-handle-inset': '8px', '--mr-expand-dir': '1' },
  position: 'relative',
  display: 'flex',
  flexShrink: 0,
  minWidth: 0,
  minHeight: 0,
  maxWidth: '100%',
  '@media': {
    '(pointer: coarse)': { vars: { '--mr-panel-handle-inset': '12px' } },
  },
  selectors: {
    "&[data-side='end']": { vars: { '--mr-expand-dir': '-1' } },
    '&:dir(rtl)': { vars: { '--mr-expand-dir': '-1' } },
    "&[data-side='end']:dir(rtl)": { vars: { '--mr-expand-dir': '1' } },
  },
});

// The panel's first child sits between it and the content. The content keeps its own width (the
// panel's smallest, or the width it opens to or closes from) while the panel is narrower, so it
// slides in and out of view at the panel's moving edge, next to the splitter, instead of reflowing.
globalStyle(`${Panel} > :first-child`, {
  display: 'flex',
  width: '100%',
  minWidth: 0,
  minHeight: 0,
  overflowX: 'clip',
  transition: 'transform 160ms cubic-bezier(0.2, 0, 0, 1)',
  '@media': {
    '(prefers-reduced-motion: reduce)': { transition: 'none' },
  },
});
// Zero transition lag while actively dragging, and no reverse recoil when snapping to filled width.
globalStyle(`${Panel}:is([data-dragging], [data-filled]) > :first-child`, {
  transition: 'none',
});
// Damped elastic give in the resize direction while dragging past maxWidth; never alters layout width.
globalStyle(`${Panel}[data-expand-charging] > :first-child`, {
  transform: 'translateX(calc(var(--mr-expand-pull, 0px) * var(--mr-expand-dir, 1)))',
  '@media': {
    '(prefers-reduced-motion: reduce)': { transform: 'none' },
  },
});
// The page navigation's moving edge is its end, so its content slides toward the rail.
globalStyle(`${Panel}[data-side='start'] > :first-child`, { justifyContent: 'flex-end' });
globalStyle(`${Panel} > :first-child > *`, {
  flex: '0 0 auto',
  width: 'var(--mr-panel-content-width, 100%)',
});

export const Handle = style({
  position: 'absolute',
  insetBlock: 0,
  insetInlineEnd: 'calc(-1 * var(--mr-panel-handle-inset))',
  width: 'calc(2 * var(--mr-panel-handle-inset))',
  zIndex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'col-resize',
  touchAction: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
  outline: 'none',
  selectors: {
    [`${Panel}[data-side='end'] &`]: {
      insetInlineEnd: 'auto',
      insetInlineStart: 'calc(-1 * var(--mr-panel-handle-inset))',
    },
  },
});

// Flat panels keep a subtle full-height divider at rest and brighten in Primary.Main on hover,
// focus, active or drag; floating cards reshape this into an inset vertical pill.
globalStyle(`${Handle} [data-panel-handle-pill]`, {
  position: 'relative',
  display: 'block',
  inlineSize: 2,
  blockSize: '100%',
  borderRadius: 0,
  backgroundColor: color.Background.ContainerLine,
  pointerEvents: 'none',
  transition:
    'background-color 140ms ease, inline-size 140ms ease, block-size 160ms ease, border-radius 140ms ease, opacity 140ms ease, box-shadow 140ms ease',
  '@media': {
    '(prefers-reduced-motion: reduce)': { transition: 'none' },
  },
});

globalStyle(
  `${Handle}:is(:hover, :focus-visible, :active) [data-panel-handle-pill], ${Panel}[data-dragging] > ${Handle} [data-panel-handle-pill]`,
  { backgroundColor: color.Primary.Main }
);

// Dragging past maxWidth stretches the solid accent pill monotonically with `--mr-expand-progress`
// (`0` -> `1`) with no size transition lag or background flip that could flicker at the max edge.
// Floating cards set `--mr-pill-base-height` / `--mr-pill-target-height` to grow the centered pill;
// flat panels stay full-height and thicken monotonically so the room/thread divider never shrinks.
globalStyle(`${Panel}[data-expand-charging] > ${Handle} [data-panel-handle-pill]`, {
  inlineSize:
    'calc(var(--mr-pill-base-width, 2px) + (4.5px - var(--mr-pill-base-width, 2px)) * var(--mr-expand-progress, 0))',
  blockSize:
    'calc(var(--mr-pill-base-height, 100%) + (var(--mr-pill-target-height, 100%) - var(--mr-pill-base-height, 100%)) * var(--mr-expand-progress, 0))',
  borderRadius: 'var(--mr-pill-radius, 0px)',
  backgroundColor: color.Primary.Main,
  boxShadow: `0 0 10px color-mix(in srgb, ${color.Primary.Main} 45%, transparent)`,
  opacity: 1,
  transition: 'opacity 140ms ease, box-shadow 140ms ease',
  '@media': {
    '(prefers-reduced-motion: reduce)': { transition: 'none' },
  },
});

// Once armed past EXPAND_PAST, hide the handle pill so no vertical line competes with the snap preview.
globalStyle(`${Panel}[data-expand-preview] > ${Handle} [data-panel-handle-pill]`, {
  opacity: 0,
});

// Full-room snap target silhouette shown while releasing the drag will fill the room.
globalStyle(`${Panel} > [data-panel-expand-ghost]`, {
  position: 'absolute',
  insetBlock: 0,
  insetInlineEnd: 0,
  width: 'var(--mr-expand-target-width, 100%)',
  borderRadius: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  paddingInline: config.space.S400,
  boxSizing: 'border-box',
  backgroundColor: `color-mix(in srgb, ${color.Primary.Main} 11%, transparent)`,
  border: `1.5px solid color-mix(in srgb, ${color.Primary.Main} 65%, transparent)`,
  pointerEvents: 'none',
  zIndex: 10,
  animation: `${expandGhostEnter} 160ms cubic-bezier(0.2, 0, 0, 1)`,
  '@media': {
    '(prefers-reduced-motion: reduce)': { animation: 'none' },
  },
});

globalStyle(`${Panel}[data-side='start'] > [data-panel-expand-ghost]`, {
  insetInlineStart: 0,
  insetInlineEnd: 'auto',
});

globalStyle(`${Panel} > [data-panel-expand-ghost] > [data-panel-expand-ghost-badge]`, {
  display: 'inline-flex',
  alignItems: 'center',
  maxInlineSize: '100%',
  paddingBlock: config.space.S200,
  paddingInline: config.space.S400,
  borderRadius: config.radii.Pill,
  backgroundColor: color.Surface.Container,
  color: color.Primary.Main,
  border: `1.5px solid color-mix(in srgb, ${color.Primary.Main} 55%, transparent)`,
  boxShadow: config.shadow.E200,
  fontSize: config.fontSize.T300,
  fontWeight: config.fontWeight.W600,
  lineHeight: config.lineHeight.T300,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

// Dim the conversation sibling beside a charging end-side panel inside a flat page (e.g.
// RoomView's thread column inside <Page>). Scoped to `PageSurface` with direct-child `:has(> ...)`
// so mutations inside message rows never re-evaluate the selector across the document.
globalStyle(`${PageSurface}:has(> ${Panel}[data-side='end']) > :not(${Panel})`, {
  transition: 'opacity 140ms ease',
  '@media': {
    '(prefers-reduced-motion: reduce)': { transition: 'none' },
  },
});
globalStyle(
  `${PageSurface}:has(> ${Panel}[data-side='end'][data-expand-charging]) > :not(${Panel})`,
  { opacity: 0.55 }
);

// Keep the scrollbar's hit area clear of the splitter; full-width panels have no handle.
globalStyle(`${Panel}[data-side='start']:has(> ${Handle})`, {
  vars: { '--mr-scrollbar-inset-end': 'var(--mr-panel-handle-inset)' },
});
