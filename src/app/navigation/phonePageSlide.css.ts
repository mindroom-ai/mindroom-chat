import { globalKeyframes, globalStyle } from '@vanilla-extract/css';
import { color } from 'folds';
import { motion } from '../ui/styles/Motion.css';

// A phone's page slide (phonePageSlide.ts): a still copy of the phone layout as it was, laid over
// the layout, and the layout as it is move past each other with `translate`, which lays nothing
// out and leaves an element's own `transform` (the navigation drawer's) alone.
// `html[data-page-slide]` is there from the call until the slide ends, and says `forward` or
// `back` once the page has changed and the copy is in.

const STAGE = '[data-phone-stage]';
const COPY = '[data-page-slide-copy]';
const PREVIEW = '[data-swipe-preview]';
const DIM = '[data-swipe-dim]';
const HOLD_SHIELD = '[data-swipe-hold-shield]';
// What slides: all of the layout but the top bar, which stays above every page.
const SLIDES = `:not([data-phone-top-bar], [data-page-slide-copy], ${PREVIEW}, ${DIM}, ${HOLD_SHIELD})`;
const forward = "html[data-page-slide='forward']";
const back = "html[data-page-slide='back']";
const playing = (selector: string) => `${forward} ${selector}, ${back} ${selector}`;

// The layout takes no taps while it slides: they would land on what moves. Over the layout only,
// and gone with it: a page that takes its place (signed out, turned sideways) takes taps at once.
globalStyle(playing(`${STAGE}::after`), {
  content: '""',
  position: 'absolute',
  inset: 0,
  zIndex: 2147483647,
});

// Nothing that slides shows outside the layout or makes it scroll, and the copy's place under or
// over the layout's own layers (the drawer) is counted inside it.
globalStyle(playing(STAGE), { overflow: 'clip', isolation: 'isolate' });
globalStyle(`${STAGE}[data-swipe-stage]`, { overflow: 'clip', isolation: 'isolate' });
// The copy fills the layout as the layout fills its own place (`position` is set on it, over
// the layout's own).
globalStyle(COPY, { inset: 0, pointerEvents: 'none' });
globalStyle(`${forward} ${COPY}`, { zIndex: -1 });
globalStyle(`${back} ${COPY}`, { zIndex: 2 });
// Still: what played in the page when it was copied shows as it ended, and plays no more.
globalStyle(`${COPY} > * *`, {
  animationDelay: '-100s !important',
  animationPlayState: 'paused !important',
});

// Interactive finger-following thread <-> room swipe preview and dim veil layers.
globalStyle(PREVIEW, {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
});
globalStyle(`${PREVIEW}[data-swipe-backdrop]`, {
  insetBlockStart: 0,
  backgroundColor: color.Surface.Container,
});
globalStyle("[data-swipe-preview='under'], [data-swipe-preview='backdrop']", {
  zIndex: -1,
});
globalStyle("[data-swipe-preview='over'], [data-swipe-preview='over-backdrop']", {
  zIndex: 2,
});
globalStyle("[data-swipe-preview='hold']", {
  zIndex: 2,
});
// Blocks taps below the top bar while an async interactive handoff awaits route commit,
// so taps on the settled preview cannot activate controls in the departing page underneath.
globalStyle(HOLD_SHIELD, {
  position: 'absolute',
  insetInline: 0,
  insetBlockEnd: 0,
  insetBlockStart: 0,
  zIndex: 3,
  pointerEvents: 'auto',
});

globalStyle(DIM, {
  position: 'absolute',
  insetInline: 0,
  insetBlockEnd: 0,
  insetBlockStart: 0,
  backgroundColor: 'rgb(0 0 0)',
  pointerEvents: 'none',
});
globalStyle("[data-swipe-dim='back']", {
  zIndex: -1,
});
globalStyle("[data-swipe-dim='forward']", {
  zIndex: 1,
});

// The end edge is the right one, or the left where lines run right to left.
globalStyle('html', { vars: { '--phone-slide-end': '1' } });
globalStyle("html[dir='rtl']", { vars: { '--phone-slide-end': '-1' } });
// As far as the phone is wide, whatever the width of what slides (the drawer is narrower).
const offEnd = 'calc(100vw * var(--phone-slide-end)) 0';
// The page under moves a third as far, as it does in a phone's own apps.
const aside = 'calc(-30vw * var(--phone-slide-end)) 0';

const overIn = 'phone-page-over-in';
const overOut = 'phone-page-over-out';
const underIn = 'phone-page-under-in';
const underOut = 'phone-page-under-out';
globalKeyframes(overIn, { from: { translate: offEnd } });
globalKeyframes(overOut, { to: { translate: offEnd } });
globalKeyframes(underIn, { from: { translate: aside } });
globalKeyframes(underOut, { to: { translate: aside } });

// As long as the navigation drawer's slide, which this one shows in place of.
const play = (name: string) =>
  `${name} ${motion.duration.Slower} ${motion.easing.Standard} both` as const;

globalStyle(`${forward} ${STAGE} > ${SLIDES}`, { animation: play(overIn) });
globalStyle(`${forward} ${COPY} > ${SLIDES}`, { animation: play(underOut) });
globalStyle(`${back} ${STAGE} > ${SLIDES}`, { animation: play(underIn) });
globalStyle(`${back} ${COPY} > ${SLIDES}`, { animation: play(overOut) });
// Held at its start, the copy in the place of the page as it was, until the page that slides in
// has been drawn (`html[data-page-slide-held]`, phonePageSlide.ts).
globalStyle(`html[data-page-slide-held] :is(${STAGE}, ${COPY}) > ${SLIDES}`, {
  animationPlayState: 'paused',
});
// The page that is over casts a shadow on the one under, to its sides only: not on the top bar.
globalStyle(`${forward} ${STAGE} > [data-phone-page], ${back} ${COPY} > [data-phone-page]`, {
  boxShadow: '0 0 24px rgb(0 0 0 / 0.24)',
  clipPath: 'inset(0 -48px)',
});
