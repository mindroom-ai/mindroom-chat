import { globalStyle, style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';
import { DARK_THEMES } from '../../preferences/themeNames';
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
  justifyContent: 'center',
  alignItems: 'flex-start',
});

// The avatar column beside the content. It keeps its width while empty, so the bodies of a run
// of follow-ups from one sender line up under the first.
export const AvatarColumn = style({
  width: toRem(MESSAGE_AVATAR_WIDTH_PX),
  flexShrink: 0,
});

export const LayoutContent = style({
  minWidth: 0,
  flexGrow: 1,
  flexBasis: 0,
});

// The foldable body of a message row: the wrapper the timeline marks with `data-message-fold`.
globalStyle('[data-message-fold]', {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  maxWidth: '100%',
});

// A person's text message is only as wide as its text, so a short line leaves the row empty
// beside it. Once it folds, its preview and Show full message button take the whole column.
globalStyle('[data-message-fold="text"]:not(:has(> * > [data-message-disclosure]))', {
  alignItems: 'flex-start',
});

// A text message that reads the other way from the interface sits at its own start, as one that
// fills the column does: a short Arabic message at the right in an English interface, a short
// English one at the left in an Arabic interface.
globalStyle(
  [
    'html[dir="ltr"] [data-message-fold="text"] > :has([data-body-direction="rtl"])',
    'html[dir="rtl"] [data-message-fold="text"] > :has([data-body-direction="ltr"])',
  ].join(', '),
  { alignSelf: 'flex-end' }
);

const bubbleColors = color.SurfaceVariant;

// A bubble only as wide as its content, up to the content column or a readable 40rem, whichever
// is narrower: on a wide window the lines stay short enough to read and own and others' bubbles
// stay apart.
export const BubbleContent = style({
  width: 'fit-content',
  minWidth: 0,
  maxWidth: `min(100%, ${toRem(640)})`,
  display: 'flex',
  flexDirection: 'column',
  rowGap: config.space.S100,
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  borderRadius: config.radii.R500,
  backgroundColor: bubbleColors.Container,
  color: bubbleColors.OnContainer,
});

// The reader's own bubble sits at the end of the content column.
export const OwnBubble = style({ marginInlineStart: 'auto' });

// Sender names take the colour of the sender's standing in the room: whoever leads it (creators
// and administrators) in blue, moderators in violet, everyone else in teal. The dark themes use
// lighter shades of the same hues.
const nameTone = (light: string, dark: string) => ({
  color: light,
  selectors: { [`${DARK_THEMES} &`]: { color: dark } },
});

export const Username = recipe({
  base: [
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
  ],
  variants: {
    tone: {
      lead: nameTone('#4365B0', '#93AEF0'),
      moderator: nameTone('#7C4AB0', '#C3A0EC'),
      member: nameTone('#357381', '#7CC0CC'),
    },
  },
});

/** The name itself: medium weight, so it reads as a label rather than a heading. */
export const UsernameName = style({ fontWeight: 500 });

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
