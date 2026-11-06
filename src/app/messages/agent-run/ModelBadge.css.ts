import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { MESSAGE_AVATAR_WIDTH_PX, MESSAGE_LAYOUT_GAP_SPACE_KEY } from '../layout/config';
import { getModelBadgeMaxWidth } from './modelBadgeLayout';

// Under the avatar the badge starts at the avatar's leading edge and may use the avatar column
// plus the gap to the text, 48 px at 100 % zoom, leaving the gutter before the avatar (where a
// thread's minimap draws its strips) alone; a longer model name is cut with an ellipsis, and the
// badge shows the full name on hover, focus or a tap.
const widestBadge = getModelBadgeMaxWidth(
  toRem(MESSAGE_AVATAR_WIDTH_PX),
  config.space[MESSAGE_LAYOUT_GAP_SPACE_KEY]
);

// The badge reads like the tool rows beside it: the variant surface with a hairline outline.
const badgeTone = color.SurfaceVariant;
const pillOutline = `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`;
// 10 px text on a 12 px line, so the pill is 14 px tall with its outline.
const badgeTextPx = 10;
const badgeLinePx = 12;

// The pill, painted behind the text from the button's top edge, so taps pass to the button.
const pillLayer = {
  pointerEvents: 'none',
  position: 'absolute',
  insetBlockStart: `calc(-1 * ${config.borderWidth.B300})`,
  insetInline: `calc(-1 * ${config.borderWidth.B300})`,
  blockSize: `calc(${toRem(badgeLinePx)} + 2 * ${config.borderWidth.B300})`,
  zIndex: -1,
  boxSizing: 'border-box',
  border: pillOutline,
  borderRadius: config.radii.Pill,
  backgroundColor: badgeTone.Container,
  content: '""',
} as const;

/**
 * Small pill under an agent's avatar naming the model that wrote the message. The button is the
 * hit area and a layer behind its text paints the pill, so a touch screen can reserve a 44 px
 * target in layout, clear of the avatar, tool rows and sticky thread banner, while the pill keeps
 * its 14 px.
 */
export const Badge = style({
  // As wide as the name, at most the avatar column plus the gap after it.
  boxSizing: 'border-box',
  position: 'relative',
  isolation: 'isolate',
  selectors: {
    '&::before': pillLayer,
    '&:focus-visible': { outline: 'none' },
    '&:focus-visible::before': {
      outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
      outlineOffset: toRem(1),
    },
  },
  margin: 0,
  fontFamily: 'inherit',
  width: 'max-content',
  maxWidth: widestBadge,
  minWidth: 0,
  flexShrink: 0,
  paddingInline: toRem(4),
  border: `${config.borderWidth.B300} solid transparent`,
  borderRadius: config.radii.Pill,
  backgroundColor: 'transparent',
  color: badgeTone.OnContainer,
  // The provider mark, then the name on one line.
  display: 'inline-flex',
  columnGap: toRem(2),
  alignItems: 'center',
  fontSize: toRem(badgeTextPx),
  lineHeight: toRem(badgeLinePx),
  fontWeight: 500,
  whiteSpace: 'nowrap',
  cursor: 'default',
  '@media': {
    '(pointer: coarse)': {
      // The target reaches 30 px below the pill, into the empty avatar column.
      paddingBlockEnd: toRem(44 - badgeLinePx - 2),
      minInlineSize: 44,
      borderRadius: 0,
    },
  },
});

export const Icon = style({
  display: 'block',
  flexShrink: 0,
});

export const Label = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});
