import { globalKeyframes, globalStyle } from '@vanilla-extract/css';
import { motion } from '../ui/styles/Motion.css';

// A phone's page slide (phonePageSlide.ts): the browser plays it between a picture of the phone
// layout as it was and the layout as it is, both the size of the layout, so nothing is laid out.
// `html[data-page-slide]` is there from before the first picture until the slide ends, and says
// `forward` or `back` once the page has changed.

const STAGE = 'phone-stage';
const TOP_BAR = 'phone-top-bar';
const sliding = 'html[data-page-slide]';
const forward = "html[data-page-slide='forward']";
const back = "html[data-page-slide='back']";

// Only the phone layout is in the pictures: the rest of the document shows as it is.
globalStyle(sliding, { viewTransitionName: 'none' });
globalStyle(`${sliding} [data-phone-stage]`, { viewTransitionName: STAGE });
// The top bar stays above every page: it is no part of the layout's picture, and shows as it is.
globalStyle(`${sliding} [data-phone-top-bar]`, { viewTransitionName: TOP_BAR });
// (WebKit plays the browser's own fade on a picture that is not displayed.)
globalStyle(`${sliding}::view-transition-old(${TOP_BAR})`, { display: 'none', animation: 'none' });
globalStyle(`${sliding}::view-transition-new(${TOP_BAR})`, { animation: 'none' });
// Neither box moves or changes its size: the pictures inside the layout's are all that plays.
globalStyle(
  `${sliding}::view-transition-group(${STAGE}), ${sliding}::view-transition-group(${TOP_BAR})`,
  { animation: 'none' }
);

// The end edge is the right one, or the left where lines run right to left.
globalStyle('html', { vars: { '--phone-slide-end': '1' } });
globalStyle("html[dir='rtl']", { vars: { '--phone-slide-end': '-1' } });
const offEnd = 'translateX(calc(100% * var(--phone-slide-end)))';
// The page under moves a third as far, as it does in a phone's own apps.
const aside = 'translateX(calc(-30% * var(--phone-slide-end)))';

const overIn = 'phone-page-over-in';
const overOut = 'phone-page-over-out';
const underIn = 'phone-page-under-in';
const underOut = 'phone-page-under-out';
globalKeyframes(overIn, { from: { transform: offEnd } });
globalKeyframes(overOut, { to: { transform: offEnd } });
globalKeyframes(underIn, { from: { transform: aside } });
globalKeyframes(underOut, { to: { transform: aside } });

// As long as the navigation drawer's slide, which this one shows in place of.
const play = (name: string) =>
  `${name} ${motion.duration.Slower} ${motion.easing.Standard} both` as const;
// The pictures show whole, not blended as in the browser's own cross-fade.
const over = {
  mixBlendMode: 'normal',
  zIndex: 1,
  boxShadow: '0 0 24px rgb(0 0 0 / 0.24)',
} as const;
const under = { mixBlendMode: 'normal' } as const;

globalStyle(`${forward}::view-transition-old(${STAGE})`, { ...under, animation: play(underOut) });
globalStyle(`${forward}::view-transition-new(${STAGE})`, { ...over, animation: play(overIn) });
globalStyle(`${back}::view-transition-old(${STAGE})`, { ...over, animation: play(overOut) });
globalStyle(`${back}::view-transition-new(${STAGE})`, { ...under, animation: play(underIn) });
