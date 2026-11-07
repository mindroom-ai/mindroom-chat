import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';
import { glassShadow } from '../ui/styles/Glass.css';
import { noticeMotionFromAbove, noticeMotionFromBelow } from '../ui/noticeMotion.css';

const listMotion = noticeMotionFromBelow;
const listEndGap = `max(${config.space.S200}, var(--mr-panel-handle-inset, 0px))`;
const pageMotion = noticeMotionFromAbove;

// The live region at the top of the app's content box (NoticeLayoutContent), as wide as the box
// and no height. Signed out, the card floats from it, so it moves with the operator notices above.
export const Region = style({ position: 'relative', flexShrink: 0 });

// The notice's card. In the room list's place it is as wide as the list's content, the text beside
// the mark and Reload under it. In the page's place it is one row as wide as it needs, Reload
// going under the text only when the row is too narrow; on a phone it spans the page under the
// top bar. Its places take no clicks, the card does.
export const Card = recipe({
  base: {
    pointerEvents: 'auto',
    gap: config.space.S300,
    padding: config.space.S300,
    borderRadius: config.radii.R500,
  },
  variants: {
    placement: {
      list: {
        ...listMotion,
        flexShrink: 0,
        // Clear of the splitter, which reaches --mr-panel-handle-inset at most into the list.
        inlineSize: `calc(var(--mr-panel-content-width, 100%) - ${config.space.S200} - ${listEndGap})`,
        marginInlineStart: config.space.S200,
        marginInlineEnd: listEndGap,
        // Its place clips it at the list's sides, S200 away: a shadow that ends within them.
        selectors: {
          ...listMotion.selectors,
          '&&&': { vars: { [glassShadow]: `0 ${toRem(2)} ${toRem(6)} ${color.Other.Shadow}` } },
        },
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        gridTemplateAreas: '"mark text dismiss" ". action action"',
        rowGap: config.space.S200,
        alignItems: 'start',
      },
      page: {
        ...pageMotion,
        display: 'flex',
        alignItems: 'center',
        maxInlineSize: toRem(480),
        selectors: {
          ...pageMotion.selectors,
          // A phone's place spans the page, and so does the card.
          '[data-phone] > &': { maxInlineSize: 'none' },
        },
      },
    },
  },
});

/** The update mark, in an accent tile. */
export const Mark = recipe({
  base: {
    flexShrink: 0,
    display: 'grid',
    placeItems: 'center',
    inlineSize: toRem(28),
    blockSize: toRem(28),
    borderRadius: config.radii.R400,
    backgroundColor: color.Primary.Container,
    color: color.Primary.Main,
  },
  variants: { placement: { list: { gridArea: 'mark' }, page: {} } },
});

export const Body = recipe({
  variants: {
    placement: {
      list: { display: 'contents' },
      page: {
        flexGrow: 1,
        minInlineSize: 0,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: config.space.S200,
      },
    },
  },
});

export const Text = recipe({
  base: { minInlineSize: 0, overflowWrap: 'anywhere' },
  variants: {
    placement: {
      list: { gridArea: 'text', alignSelf: 'center' },
      page: { flex: '1 1 0', minInlineSize: '10em' },
    },
  },
});

export const Action = recipe({
  variants: { placement: { list: { gridArea: 'action', justifySelf: 'start' }, page: {} } },
});

export const Dismiss = recipe({
  variants: { placement: { list: { gridArea: 'dismiss' }, page: {} } },
});
