import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';
import { MESSAGE_AVATAR_WIDTH_PX } from './config';

export const MessageBase = recipe({
  base: [
    DefaultReset,
    {
      position: 'relative',
      padding: `${config.space.S100} ${config.space.S400}`,
      borderRadius: config.radii.R400,
      outline: 'none',
      selectors: {
        '&:focus-visible': {
          boxShadow: `inset 0 0 0 ${config.borderWidth.B600} ${color.Primary.Main}`,
        },
      },
    },
  ],
  variants: {
    space: {
      '0': { marginTop: 0 },
      '100': { marginTop: config.space.S100 },
      '200': { marginTop: config.space.S200 },
      '300': { marginTop: config.space.S300 },
      '400': { marginTop: config.space.S400 },
      '500': { marginTop: config.space.S500 },
    },
    collapse: {
      true: { marginTop: 0 },
    },
    highlight: {
      true: { backgroundColor: color.Primary.Container },
    },
    selected: {
      true: { backgroundColor: color.Surface.ContainerActive },
    },
  },
  defaultVariants: { space: '400' },
});

export const AvatarBase = style({
  paddingTop: toRem(4),
  width: toRem(MESSAGE_AVATAR_WIDTH_PX),
  display: 'flex',





  width: toRem(MESSAGE_AVATAR_WIDTH_PX),
  flexShrink: 0,
});

export const LayoutContent = style({
  minWidth: 0,







  minWidth: 0,
  maxWidth: '100%',
  alignSelf: 'flex-start',
  display: 'flex',






});

export const Username = style([
  DefaultReset,
  {
    display: 'inline-flex',
    minWidth: 0,
    padding: 0,
    border: 'none',
    background: 'none',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
    selectors: {
      '&:hover, &:focus-visible': { textDecoration: 'underline' },
    },
  },
]);

export const MessageTextBody = recipe({
  base: {
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  },
  variants: {
    preWrap: { true: { whiteSpace: 'pre-wrap' } },
    jumboEmoji: { true: { fontSize: toRem(32), lineHeight: toRem(44) } },
    emote: { true: { fontStyle: 'italic' } },
    notice: { true: { opacity: config.opacity.P500 } },
  },
});

export const ReplyLayout = style({
  minWidth: 0,
  gap: config.space.S100,
});
