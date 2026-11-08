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

// The notice's card. In the room list's place it is as wide as the list's content: the mark, the
// text and the dismiss button side by side at the top, Reload under the text (Action places it).
// In the page's place it is one row as wide as it needs, Reload going under the text only when
// the row is too narrow (NewVersionNotice.tsx wraps the two); on a phone it spans the page under
// the top bar. Its places take no clicks, the card does. S300 is its inset and the room between
// its parts, S200 the room between the text and Reload.
export const Card = recipe({
  base: { pointerEvents: 'auto', padding: config.space.S300, borderRadius: config.radii.R500 },
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
        gap: `${config.space.S200} ${config.space.S300}`,
        alignItems: 'start',
      },
      page: {
        ...pageMotion,
        display: 'flex',
        alignItems: 'center',
        gap: config.space.S300,
        maxInlineSize: toRem(480),
        selectors: {
          ...pageMotion.selectors,
          // A phone's place spans the page, and so does the card (its place centres the others).
          '[data-phone] > &': { justifySelf: 'stretch', maxInlineSize: 'none' },
        },
      },
    },
  },
});

// The update mark: the 18 px download icon 5 px inside an accent tile, so the tile is 28 px
// square. It does not shrink in a full row, where the icon would give way first.
export const Mark = style([
  { display: 'grid', flexShrink: 0, padding: toRem(5), borderRadius: config.radii.R400 },
  { color: color.Primary.Main, backgroundColor: color.Primary.Container },
]);

export const Text = recipe({
  base: { minInlineSize: 0, overflowWrap: 'anywhere' },
  variants: {
    placement: {
      list: { alignSelf: 'center' },
      // Reload goes under the text once the text would get narrower than 10em beside it.
      page: { flex: '1 1 0', minInlineSize: '10em' },
    },
  },
});

// In the room list's place: the second row, from the text's column to the end, at its start.
export const Action = recipe({
  variants: {
    placement: { list: { gridArea: '2 / 2 / auto / -1', justifySelf: 'start' }, page: {} },
  },
});
