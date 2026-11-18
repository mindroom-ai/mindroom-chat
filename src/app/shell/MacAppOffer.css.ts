import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { config, toRem } from 'folds';
import { noticeCard, noticeCardInList, noticeCardOnPage, noticeMark } from '../ui/noticeSlots.css';

/**
 * The offer's card, placed as the tour's offer is (tour/TourOffer.css.ts), and among the cards of
 * its place where the tour's offer would be: above the new version notice in the room list's
 * place, under it in the page's. Stacked, in the list and on a phone, the title and text sit
 * beside the mark and the two buttons under them. In a row, on a wider page, one line says it,
 * followed by the download button, which goes under it only when the row is too narrow.
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
        gridTemplateAreas: '"mark words dismiss" ". actions actions"',
        rowGap: config.space.S200,
        alignItems: 'start',
      },
      row: { display: 'flex', alignItems: 'center' },
    },
  },
});

/** The Mac app's mark, in an accent tile. */
export const Mark = recipe({
  base: noticeMark,
  variants: { layout: { stacked: { gridArea: 'mark' }, row: {} } },
});

/** The title over the text; the title's first line is level with the middle of the mark. */
export const Words = style({
  gridArea: 'words',
  minInlineSize: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: toRem(2),
  paddingBlockStart: `calc((${noticeMark.blockSize} - ${config.lineHeight.T300}) / 2)`,
  overflowWrap: 'anywhere',
});

/** The title, heavier than the text under it. */
export const Title = style({ fontWeight: config.fontWeight.W600 });

/** The download and Not now buttons, side by side where both fit, else one under the other. */
export const Actions = style({
  gridArea: 'actions',
  display: 'flex',
  flexWrap: 'wrap',
  gap: config.space.S200,
});

/** The row's line and its download button, which wraps under the line when the row is narrow. */
export const Line = style({
  flexGrow: 1,
  display: 'flex',
  flexWrap: 'wrap',
  minInlineSize: 0,
  alignItems: 'center',
  columnGap: config.space.S300,
  rowGap: config.space.S200,
});

/** The row's sentence, its question in bold. */
export const Sentence = style({ flex: '1 1 0', minInlineSize: '12em', overflowWrap: 'anywhere' });

/** The dismiss button, in the corner after the words. */
export const Dismiss = recipe({
  variants: { layout: { stacked: { gridArea: 'dismiss' }, row: {} } },
});
