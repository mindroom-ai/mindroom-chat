import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';
import { phoneTopBarHeight } from '../sidebar/PhoneTopBar.css';

/** Phones get the phone layout up to 750 px wide (lib/hooks/useScreenSize.ts). */
const phone = '(max-width: 750px)';

// The live region: the first row of the app's content box (NoticeLayoutContent), as wide as the
// box and no height. The card over the page is placed against it, so it moves with the operator
// notices above and with a phone's keyboard, and the region covers nothing it could take clicks
// from.
export const Region = style({ position: 'relative', flexShrink: 0 });

// The notice's card. At the foot of the room list it stacks its text over Reload, as wide as the
// list. Without a list beside the page it floats over the page, which stays where it is, in one
// row: centred at the top on wider screens, right below the top bar on a phone, clear of the
// composer.
export const Card = recipe({
  base: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: config.space.S300,
    padding: config.space.S300,
    borderRadius: config.radii.R500,
  },
  variants: {
    placement: {
      list: {},
      page: {
        position: 'absolute',
        // Above the pages, below folds' dialogs, menus and tooltips in their own layer.
        zIndex: 1000,
        insetBlockStart: config.space.S300,
        insetInline: 0,
        marginInline: 'auto',
        inlineSize: 'fit-content',
        maxInlineSize: `min(${toRem(480)}, calc(100% - 2 * ${config.space.S300}))`,
        alignItems: 'center',
        '@media': {
          [phone]: {
            insetBlockStart: `calc(${phoneTopBarHeight} + ${config.space.S200})`,
            insetInline: config.space.S200,
            inlineSize: 'auto',
            maxInlineSize: 'none',
            // The navigation drawer and a room's members slide in under the top bar, over the
            // page: the notice waits under them.
            selectors: { '[data-phone-layer-open] > &': { display: 'none' } },
          },
        },
      },
    },
  },
});

/** The update mark, in an accent tile. */
export const Mark = style({
  flexShrink: 0,
  display: 'grid',
  placeItems: 'center',
  inlineSize: toRem(28),
  blockSize: toRem(28),
  borderRadius: config.radii.R400,
  backgroundColor: color.Primary.Container,
  color: color.Primary.Main,
});

// Text and Reload: in one row on the page, Reload going under the text when the row is too
// narrow for both; at the foot of the list always under the text.
export const Body = style({
  flexGrow: 1,
  minInlineSize: 0,
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S200,
});

export const Text = recipe({
  base: { minInlineSize: 0, overflowWrap: 'anywhere' },
  variants: {
    placement: {
      list: { flexBasis: '100%' },
      page: { flex: '1 1 0', minInlineSize: '10em' },
    },
  },
});
