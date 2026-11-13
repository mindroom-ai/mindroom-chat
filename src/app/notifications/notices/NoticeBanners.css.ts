import { globalStyle, style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';

// In normal flow above the app, so the layout below shrinks instead of being covered.
export const NoticeStack = style({
  // Positioned, so it paints above the fixed particle background that comes before it in the page.
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  width: '100%',
  overscrollBehavior: 'contain',
  // Expanded notices never take more than half of #root, which follows the keyboard on iOS.
  maxHeight: '50%',
  overflowY: 'auto',
});

const levelColors = (tone: typeof color.Primary) => ({
  backgroundColor: tone.Container,
  color: tone.OnContainer,
  borderColor: tone.ContainerLine,
});

export const Notice = recipe({
  base: {
    // Rows keep their height; the capped stack scrolls instead.
    flexShrink: 0,
    display: 'flex',
    alignItems: 'flex-start',
    gap: config.space.S200,
    minHeight: toRem(36),
    paddingBlock: config.space.S100,
    paddingInline: `${config.space.S300} ${config.space.S200}`,
    borderBottomWidth: config.borderWidth.B300,
    borderBottomStyle: 'solid',
  },
  variants: {
    level: {
      info: levelColors(color.Primary),
      warning: levelColors(color.Warning),
      success: levelColors(color.Success),
      critical: levelColors(color.Critical),
    },
  },
});

export const NoticeIcon = style({
  flexShrink: 0,
  display: 'inline-flex',
  lineHeight: 1,
});

export const NoticeBody = style({
  flexGrow: 1,
  minWidth: 0,
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  columnGap: config.space.S200,
});

export const NoticeText = style({
  flex: '0 1 auto',
  minWidth: 0,
  overflowWrap: 'anywhere',
});

// Three lines keep the banner slim on a phone; "Show more" reveals the rest.
export const NoticeTextCollapsed = style({
  WebkitLineClamp: '3',
  WebkitBoxOrient: 'vertical',
  display: '-webkit-box',
  overflow: 'hidden',
});

export const NoticeAction = style({
  minWidth: 0,
  overflowWrap: 'anywhere',
  textAlign: 'start',
  padding: 0,
  border: 'none',
  background: 'none',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
  textDecoration: 'underline',
  textUnderlineOffset: toRem(2),
});

// Inline links keep the banner's own color, which meets contrast on every level.
globalStyle(`${NoticeText} a`, {
  color: 'inherit',
  textDecoration: 'underline',
  textUnderlineOffset: toRem(2),
});

// Takes the height #root has left below the notices, so layouts that fill their parent
// keep their headers and composer on screen.
export const NoticeLayoutContent = style({
  flex: '1 1 0',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
});
