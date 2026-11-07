import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { phoneTopBarHeight } from '../sidebar/PhoneTopBar.css';

/** The icon rail's width (Sidebar in ui/sidebar/SidebarItem.css.ts). */
const railWidth = toRem(66);

/** Phones get the phone layout up to 750 px wide (lib/hooks/useScreenSize.ts). */
const phone = '(max-width: 750px)';

// A card floating over the page, which stays where it is: on a desktop at the foot of the room
// list, past the rail, where it covers only the list's last rows; on a phone, which has no room
// list beside the page, right below the top bar, clear of the composer.
export const Card = style({
  position: 'fixed',
  // Above the particle background and the pages, below folds' dialogs, menus and tooltips (9999).
  zIndex: 1000,
  insetInlineStart: `calc(env(safe-area-inset-left, 0px) + ${railWidth} + ${config.space.S200})`,
  insetBlockEnd: `calc(env(safe-area-inset-bottom, 0px) + ${config.space.S300})`,
  inlineSize: `min(${toRem(240)}, calc(100vw - ${railWidth} - 2 * ${config.space.S200}))`,
  display: 'flex',
  alignItems: 'flex-start',
  gap: config.space.S300,
  padding: config.space.S300,
  borderRadius: config.radii.R500,
  '@media': {
    [phone]: {
      insetBlockStart: `calc(env(safe-area-inset-top, 0px) + ${phoneTopBarHeight} + ${config.space.S200})`,
      insetBlockEnd: 'auto',
      insetInline: config.space.S200,
      inlineSize: 'auto',
      alignItems: 'center',
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

// The text over Reload on a desktop; on a phone, one row with Reload at its end.
export const Body = style({
  flexGrow: 1,
  minInlineSize: 0,
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S200,
});

export const Text = style({
  flexBasis: '100%',
  minInlineSize: 0,
  overflowWrap: 'anywhere',
  '@media': { [phone]: { flexBasis: 0, flexGrow: 1 } },
});
