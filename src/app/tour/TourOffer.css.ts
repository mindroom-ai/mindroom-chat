import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';
import { glassShadow } from '../ui/styles/Glass.css';
import { noticeMotionFromAbove, noticeMotionFromBelow } from '../ui/noticeMotion.css';

const listMotion = noticeMotionFromBelow;
const listEndGap = `max(${config.space.S200}, var(--mr-panel-handle-inset, 0px))`;
const pageMotion = noticeMotionFromAbove;
const markSize = toRem(28);

/**
 * The offer's card, placed as the new version notice's is (shell/NewVersionNotice.css.ts): in the
 * room list's place as wide as the list's content, in the page's place as wide as it needs, and
 * across the page on a phone. Its places take no clicks, the card does.
 * Stacked, in the list and on a phone, the words sit beside the mark and the two buttons under
 * them across the card, one under the other where it is too narrow for both. In a row, on a wider
 * page, the buttons follow the words and go under them only when the row is too narrow.
 */
export const Card = recipe({
  base: {
    gap: config.space.S300,
    padding: config.space.S300,
    pointerEvents: 'auto',
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
      },
      page: {
        ...pageMotion,
        // A phone's place has no height of its own: the card keeps the height of its content.
        flexShrink: 0,
        maxInlineSize: toRem(640),
        selectors: {
          ...pageMotion.selectors,
          // A phone's place spans the page, and so does the card.
          '[data-phone] > &': { maxInlineSize: 'none' },
        },
      },
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
  base: {
    flexShrink: 0,
    display: 'grid',
    placeItems: 'center',
    inlineSize: markSize,
    blockSize: markSize,
    borderRadius: config.radii.R400,
    backgroundColor: color.Primary.Container,
    color: color.Primary.Main,
  },
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
    paddingBlockStart: `calc((${markSize} - ${config.lineHeight.T300}) / 2)`,
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
