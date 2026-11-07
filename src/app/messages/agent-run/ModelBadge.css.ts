import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { MESSAGE_AVATAR_WIDTH_PX } from '../layout/config';
import { getModelBadgeMaxWidth } from './modelBadgeLayout';

// The name is centred under the avatar and may hang 4 px past it on each side, 44 px at 100 %
// zoom: a thread's minimap draws its resting strips in the row's 16 px gutter before the avatar,
// 4 px in from the card's edge and 8 px wide, which leaves those 4 px clear. It wraps onto a
// second line in the empty avatar column, and a longer name is cut with an ellipsis there.
const widestName = getModelBadgeMaxWidth(toRem(MESSAGE_AVATAR_WIDTH_PX), config.space.S100);
const nameTextPx = 10;
const nameLinePx = 12;
const nameLines = 2;

/** The avatar and its corner mark; a flex box, so no line box adds space under the avatar. */
export const Frame = style({
  position: 'relative',
  display: 'flex',
});

const markPx = 16;
const markOverhang = toRem(-4);

/**
 * The provider's logo in a 16 px circle over the avatar's bottom corner on the text's side, in the
 * page's colours, so it reads as cut out of the avatar.
 */
export const Mark = style({
  pointerEvents: 'none',
  position: 'absolute',
  boxSizing: 'border-box',
  inlineSize: toRem(markPx),
  blockSize: toRem(markPx),
  display: 'grid',
  placeItems: 'center',
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  borderRadius: '50%',
  insetBlockEnd: markOverhang,
  insetInlineEnd: markOverhang,
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
});

/**
 * The model's name under an agent's avatar. A touch screen gets a 44 px target, reaching down
 * into the empty avatar column, clear of the avatar, tool rows and sticky thread banner.
 */
export const Badge = style({
  boxSizing: 'border-box',
  margin: 0,
  padding: 0,
  inlineSize: 'max-content',
  maxInlineSize: widestName,
  border: 'none',
  borderRadius: config.radii.R300,
  font: 'inherit',
  fontSize: toRem(nameTextPx),
  backgroundColor: 'transparent',
  lineHeight: toRem(nameLinePx),
  color: color.Surface.OnContainer,
  fontWeight: 500,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  cursor: 'default',
  ':focus-visible': {
    outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
    outlineOffset: toRem(1),
  },
  '@media': {
    '(pointer: coarse)': {
      // Pixels, so a smaller page zoom never shrinks the target.
      minInlineSize: 44,
      minBlockSize: 44,
    },
  },
});

/** At most two lines, broken between words where it can be, as quiet as the message times. */
export const Label = style({
  display: '-webkit-box',
  WebkitLineClamp: nameLines,
  WebkitBoxOrient: 'vertical',
  opacity: config.opacity.P300,
  overflow: 'hidden',
  overflowWrap: 'anywhere',
  textAlign: 'center',
});
