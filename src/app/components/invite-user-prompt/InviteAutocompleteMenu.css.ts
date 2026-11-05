import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

// The invite dialog shows matching people in a menu that floats under its search field, or over
// it when the space below is short. The menu rides in folds' pop-out layer, which spans the whole
// viewport, so the layer lets the pointer through and only the menu takes it back. Where these
// classes meet a rule of folds' own menu row or header, a doubled class (`&&`) outranks it.

/** Groups the search field with the pop-out; its box is what the menu lines up with. */
export const InviteAutocompleteMenuRoot = style([DefaultReset]);

/** The viewport-wide layer: the dialog under it keeps its clicks, text selection and scrolling. */
export const InviteAutocompletePopOut = style([DefaultReset, { pointerEvents: 'none' }]);

/** Carries the menu at the search field's width, which the component sets inline. */
export const InviteAutocompleteMenuContainer = style([DefaultReset]);

/**
 * The glass menu: the result count on top and the list under it. Its only height limit is the
 * one the component sets inline, so the list scrolls within that.
 */
export const InviteAutocompleteMenu = style([
  DefaultReset,
  {
    pointerEvents: 'auto',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
]);

/** The result count stays whole above a long list, flat, with room at its start and end. */
export const InviteAutocompleteMenuHeader = style([
  DefaultReset,
  {
    flexShrink: 0,
    selectors: {
      '&&': { paddingBlock: 0, paddingInline: config.space.S300 },
    },
  },
]);

/**
 * One person. The row grows past 56 px as its text wraps, and the avatar stays level with the
 * first line. The suggestion that Enter or Tab would take is filled, while focus stays in the
 * search field; pressing a row still shows the menu item's own pressed fill.
 */
export const InviteAutocompleteOption = style([
  DefaultReset,
  {
    selectors: {
      '&&': {
        alignItems: 'flex-start',
        height: 'auto',
        minHeight: toRem(56),
        paddingBlock: config.space.S200,
      },
      '&[aria-selected="true"]:not(:active)': {
        backgroundColor: color.Surface.ContainerHover,
      },
    },
  },
]);

/** The name over the Matrix ID, in all the width the avatar leaves, however long either is. */
export const InviteAutocompleteIdentity = style([
  DefaultReset,
  {
    flexGrow: 1,
    minInlineSize: 0,
    display: 'flex',
    flexDirection: 'column',
    rowGap: config.space.S100,
  },
]);

// Long names and Matrix IDs break between any two characters rather than widen the row or lose
// their end to an ellipsis.
const breaksAnywhere = { minInlineSize: 0, overflowWrap: 'anywhere' } as const;

export const InviteAutocompleteDisplayName = style(breaksAnywhere);

export const InviteAutocompleteUserId = style(breaksAnywhere);
