import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { config, toRem } from 'folds';
import { noticeCard, noticeCardInList, noticeCardOnPage, noticeMark } from '../ui/noticeSlots.css';

// The live region at the top of the app's content box (NoticeLayoutContent), as wide as the box
// and no height. Signed out, the card floats from it, so it moves with the operator notices above.
export const Region = style({ position: 'relative', flexShrink: 0 });

// The notice's card. In the room list's place it is as wide as the list's content, the text beside
// the mark and Reload under it. In the page's place it is one row as wide as it needs, Reload
// going under the text only when the row is too narrow; on a phone it spans the page under the
// top bar. Its places take no clicks, the card does.
export const Card = recipe({
  base: noticeCard,
  variants: {
    placement: {
      list: {
        ...noticeCardInList,
        // At the foot of the list's place, under the tour's offer there.
        order: 1,
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        gridTemplateAreas: '"mark text dismiss" ". action action"',
        rowGap: config.space.S200,
        alignItems: 'start',
      },
      page: {
        ...noticeCardOnPage,
        // At the top of the page's place, above the tour's offer and a sync status there.
        order: -1,
        display: 'flex',
        alignItems: 'center',
        maxInlineSize: toRem(480),
      },
    },
  },
});

/** The update mark, in an accent tile. */
export const Mark = recipe({
  base: noticeMark,
  variants: { placement: { list: { gridArea: 'mark' }, page: {} } },
});

export const Body = recipe({
  variants: {
    placement: {
      list: { display: 'contents' },
      page: {
        flexGrow: 1,
        display: 'flex',
        flexWrap: 'wrap',
        minInlineSize: 0,
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
