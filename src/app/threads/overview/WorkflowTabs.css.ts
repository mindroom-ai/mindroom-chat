import { createVar, globalStyle, keyframes, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { motion } from '../../ui/styles/Motion.css';
import { transition } from '../../ui/styles/transition';
import { FilterButton } from './RoomThreadOverview.css';

// The pill and the tabs sit this far inside the group's rim.
const INSET = toRem(2);
// Concentric with the group's corners: its radius less the rim and the inset.
const INNER_RADIUS = `calc(${config.radii.R400} - ${config.borderWidth.B300} - ${INSET})`;
const ICON = toRem(12);
// Pulls the button's column gap back around an icon or label folded to nothing.
const CLOSE_GAP = `calc(-1 * ${config.space.S100})`;
const NARROW = '(max-width: 40rem)';
const REDUCED = '(prefers-reduced-motion: reduce)';
// A label unfolds over about as long as the pill's spring (useSlidingPill) takes to settle.
const UNFOLD = '460ms';
const ROLL = `380ms ${motion.easing.Decelerate}`;
// An icon's gesture starts once the pill is on its way.
const GESTURE_DELAY = 90;

// One outlined track around the five tabs, with the same rim, radius and 32 px outer height as
// the dropdowns beside it, so they read as one control.
export const WorkflowTabs = style({
  position: 'relative',
  isolation: 'isolate',
  display: 'flex',
  flexShrink: 0,
  overflowX: 'auto',
  scrollbarWidth: 'none',
  boxSizing: 'border-box',
  height: toRem(32),
  maxWidth: '100%',
  padding: INSET,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R400,
  background: color.SurfaceVariant.Container,
});

// One pill for the pressed tab, under the buttons (it comes first; they are positioned too).
// It carries the active rim, as the other lit controls do (the sort button, the dropdowns).
export const WorkflowPill = style({
  position: 'absolute',
  insetBlock: INSET,
  // eslint-disable-next-line no-restricted-syntax -- the pill follows offsetLeft, which counts from the physical left in either direction
  left: 0,
  boxSizing: 'border-box',
  border: `${config.borderWidth.B300} solid ${color.Primary.ContainerLine}`,
  borderRadius: INNER_RADIUS,
  background: color.Primary.Container,
  pointerEvents: 'none',
  willChange: 'transform, width',
  transition: transition(['opacity'], motion.duration.Normal),
});

// Reuse the dropdown's sizing, but fill the track inside its rim and inset: the group, not each
// tab, is as tall as the neighbouring triggers.
export const WorkflowTab = style([
  FilterButton,
  {
    position: 'relative',
    flexShrink: 0,
    height: '100%',
    borderRadius: INNER_RADIUS,
    borderColor: 'transparent',
    background: 'transparent',
    WebkitTapHighlightColor: 'transparent',
    transition: [
      transition(['color'], motion.duration.Slower),
      transition(['background-color', 'transform'], motion.duration.Fast),
    ].join(', '),
    selectors: {
      // Keep the inherited focus ring inside the scrollport.
      '&:focus-visible': { outlineOffset: `calc(-1 * ${config.borderWidth.B400})` },
      // The pill paints the pressed tab, so a hover tint never covers it.
      '&[aria-pressed="true"], &[aria-pressed="true"]:hover': {
        backgroundColor: 'transparent',
        color: color.Primary.OnContainer,
      },
      '&:active': { transform: 'scale(0.95)' },
    },
  },
]);

// Wide: only the pressed tab shows its icon, which grows in. Narrow: every tab shows it.
export const WorkflowIcon = style({
  display: 'inline-flex',
  flexShrink: 0,
  width: 0,
  marginInlineEnd: CLOSE_GAP,
  opacity: 0,
  transform: 'scale(0.6)',
  transition: [
    transition(['width', 'margin-inline-end'], '320ms'),
    transition(['opacity', 'transform'], motion.duration.Slower),
  ].join(', '),
  selectors: {
    '[aria-pressed="true"] &': { width: ICON, marginInlineEnd: 0, opacity: 1, transform: 'none' },
  },
  '@container': {
    [NARROW]: { width: ICON, marginInlineEnd: 0, opacity: 1, transform: 'none' },
  },
});

export const WorkflowGlyph = style({ display: 'block', overflow: 'visible' });

// Narrow: an unpressed tab folds its label away, and the pressed one unfolds it.
export const WorkflowLabel = style({
  display: 'inline-grid',
  gridTemplateColumns: '1fr',
  transition: [
    transition(['grid-template-columns', 'margin-inline-end'], UNFOLD),
    transition(['opacity'], motion.duration.Slower),
  ].join(', '),
  '@container': {
    [NARROW]: {
      selectors: {
        '[aria-pressed="false"] &': {
          gridTemplateColumns: '0fr',
          marginInlineEnd: CLOSE_GAP,
          opacity: 0,
        },
      },
    },
  },
});

export const WorkflowLabelText = style({ overflow: 'hidden', minWidth: 0 });

// ─── Odometer counts ────────────────────────────────────────────────────────

const rollDirection = createVar();
const rollIn = keyframes({
  from: { transform: `translateY(calc(${rollDirection} * 100%))`, opacity: 0 },
});
const rollOut = keyframes({
  to: { transform: `translateY(calc(${rollDirection} * -100%))`, opacity: 0 },
});

export const WorkflowCount = style({
  display: 'inline-grid',
  overflow: 'hidden',
  fontVariantNumeric: 'tabular-nums',
  opacity: 0.7,
  vars: { [rollDirection]: '1' },
  selectors: { '&[data-roll="down"]': { vars: { [rollDirection]: '-1' } } },
});
globalStyle(`${WorkflowCount} > *`, { gridArea: '1 / 1' });

export const RollIn = style({
  animation: `${rollIn} ${ROLL}`,
  '@media': { [REDUCED]: { animation: 'none' } },
});
export const RollOut = style({
  animation: `${rollOut} ${ROLL} forwards`,
  '@media': { [REDUCED]: { display: 'none' } },
});

// ─── A new thread pings Needs you ──────────────────────────────────────────

// Its end removes the dot (WorkflowTabs).
export const pingPop = keyframes({
  '0%': {
    opacity: 0,
    transform: 'scale(0.4)',
    animationTimingFunction: 'cubic-bezier(.3,1.6,.5,1)',
  },
  '8%': { opacity: 1, transform: 'none' },
  '80%': { opacity: 1 },
  '100%': { opacity: 0 },
});
const pulse = keyframes({
  from: { boxShadow: `0 0 0 0 color-mix(in srgb, ${color.Primary.Main} 60%, transparent)` },
  to: { boxShadow: `0 0 0 ${toRem(7)} transparent` },
});

export const PingDot = style({
  position: 'absolute',
  // In the tab's end padding, clear of the count.
  top: toRem(4),
  insetInlineEnd: toRem(2),
  width: toRem(6),
  height: toRem(6),
  borderRadius: '50%',
  background: color.Primary.Main,
  opacity: 0,
  pointerEvents: 'none',
  animation: `${pingPop} 3.8s ${motion.easing.Standard} forwards, ${pulse} 1.6s ease-out 2`,
  '@media': { [REDUCED]: { animation: 'none' } },
});

// ─── Icon gestures, when a tab becomes the pressed one ──────────────────────

const ring = keyframes({
  '0%': { transform: 'rotate(0)' },
  '20%': { transform: 'rotate(16deg)' },
  '40%': { transform: 'rotate(-13deg)' },
  '60%': { transform: 'rotate(9deg)' },
  '80%': { transform: 'rotate(-5deg)' },
  '100%': { transform: 'rotate(0)' },
});
const turn = keyframes({ to: { transform: 'rotate(360deg)' } });
const sweep = keyframes({ from: { transform: 'rotate(-360deg)' } });
const draw = keyframes({ from: { strokeDasharray: 22, strokeDashoffset: 22 } });
const slideIn = keyframes({ from: { transform: 'scaleX(0)', opacity: 0 } });

const glyph = (tab: string, part = '') =>
  `[data-gesture][data-thread-tab="${tab}"] ${WorkflowGlyph}${part}`;
const gesture = (selector: string, animation: string, extra: Record<string, string> = {}) =>
  globalStyle(selector, {
    ...extra,
    animation,
    '@media': { [REDUCED]: { animation: 'none' } },
  });
const EASE = motion.easing.Standard;

gesture(glyph('needsYou'), `${ring} 650ms ease-out ${GESTURE_DELAY}ms`, {
  transformOrigin: '50% 10%',
});
gesture(glyph('working'), `${turn} 800ms ${EASE} ${GESTURE_DELAY}ms`);
// The clock's hand; SVG lengths are in the 24-unit view box.
gesture(glyph('later', ' > path:nth-child(2)'), `${sweep} 700ms ${EASE} ${GESTURE_DELAY}ms`, {
  transformOrigin: '12px 12px',
});
gesture(glyph('done', ' > path'), `${draw} 420ms ${EASE} ${GESTURE_DELAY}ms backwards`);
// The list's three lines, one after another.
[1, 2, 3].forEach((line) =>
  gesture(
    glyph('all', ` > path:nth-child(${line})`),
    `${slideIn} 380ms ${EASE} ${GESTURE_DELAY + (line - 1) * 70}ms backwards`,
    { transformOrigin: '9px 12px' }
  )
);
