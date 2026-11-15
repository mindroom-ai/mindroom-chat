import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { config, toRem } from 'folds';
import { noticeCard, noticeCardInList, noticeCardOnPage, noticeMark } from '../ui/noticeSlots.css';

/**
 * The offer's card, placed as the new version notice's is (shell/NewVersionNotice.css.ts): in the
 * room list's place as wide as the list's content, in the page's place as wide as it needs, and
 * across the page on a phone. Its places take no clicks, the card does.
 * Stacked, in the list and on a phone, the words sit beside the mark and the two buttons under
 * them across the card, one under the other where it is too narrow for both. In a row, on a wider
 * page, the buttons follow the words and go under them only when the row is too narrow.
 */
export const Card = recipe({
  base: noticeCard,
  variants: {
    placement: {
      list: noticeCardInList,
      page: { ...noticeCardOnPage, maxInlineSize: toRem(640) },
    },
    layout: {
      stacked: {
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        gridTemplateAreas: '"mark words dismiss" "actions actions actions"',
        alignItems: 'start',
      },
      row: { display: 'flex', alignItems: 'flex-start' },
    },
  },
});

/** The tour's mark, in an accent tile. */
export const Mark = recipe({
  base: noticeMark,
  variants: { layout: { stacked: { gridArea: 'mark' }, row: {} } },
});

/**
 * Holds the words and the buttons. In a row it is the line they share, which wraps; stacked it
 * has no box of its own, so both are cells of the card's grid.
 */
export const Body = recipe({
  variants: {
    layout: {
      stacked: { display: 'contents' },
      row: {
        flexGrow: 1,
        display: 'flex',
        flexWrap: 'wrap',
        minInlineSize: 0,
        alignItems: 'center',
        columnGap: config.space.S300,
        rowGap: config.space.S200,
      },
    },
  },
});

/** The title over the text; the title's first line is level with the middle of the mark. */
export const Words = recipe({
  base: {
    minInlineSize: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: toRem(2),
    paddingBlockStart: `calc((${noticeMark.blockSize} - ${config.lineHeight.T300}) / 2)`,
    overflowWrap: 'anywhere',
  },
  variants: {
    layout: {
      stacked: { gridArea: 'words' },
      row: { flex: '1 1 0', minInlineSize: '12em' },
    },
  },
});

/** The title, heavier than the text under it. */
export const Title = style({ fontWeight: config.fontWeight.W600 });

/** The two buttons: side by side where both fit, else one under the other. */
export const Actions = recipe({
  base: { display: 'flex', flexWrap: 'wrap', gap: config.space.S200 },
  variants: { layout: { stacked: { gridArea: 'actions' }, row: {} } },
});

/**
 * One of the two buttons. Stacked, it fills what its row leaves it, so two in a row or one a row
 * end level with the card; a label longer than its button is cut short (its text truncates).
 */
export const Action = recipe({
  variants: { layout: { stacked: { flex: '1 1 auto' }, row: {} } },
});

/** The dismiss button, in the corner after the words. */
export const Dismiss = recipe({
  variants: { layout: { stacked: { gridArea: 'dismiss' }, row: {} } },
});
