import { style } from '@vanilla-extract/css';
import { DefaultReset, config, toRem } from 'folds';

import {
  INVITE_AUTOCOMPLETE_MENU_MAX_HEIGHT_PX,
  INVITE_AUTOCOMPLETE_MENU_MAX_VIEWPORT_PERCENT,
} from './inviteAutocompleteMenuPlacement';

export const InviteAutocompleteMenuRoot = style([DefaultReset]);

/**
 * The folds PopOut wrapper is a full-viewport fixed layer; a combobox must
 * keep the input and the rest of the page clickable while suggestions are
 * open, so pointer events pass through everywhere except the menu itself.
 */
export const InviteAutocompletePopOut = style([
  DefaultReset,
  {
    pointerEvents: 'none',
  },
]);

export const InviteAutocompleteMenuContainer = style([
  DefaultReset,
  {
    pointerEvents: 'auto',
  },
]);

export const InviteAutocompleteMenu = style([
  DefaultReset,
  {
    maxHeight: `min(${INVITE_AUTOCOMPLETE_MENU_MAX_VIEWPORT_PERCENT}vh, ${toRem(
      INVITE_AUTOCOMPLETE_MENU_MAX_HEIGHT_PX
    )})`,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
]);

export const InviteAutocompleteMenuHeader = style([
  DefaultReset,
  { padding: `0 ${config.space.S300}`, flexShrink: 0 },
]);

export const InviteAutocompleteOption = style([
  DefaultReset,
  {
    alignItems: 'flex-start',
    height: 'auto',
    minHeight: toRem(56),
    paddingTop: config.space.S200,
    paddingBottom: config.space.S200,
  },
]);

export const InviteAutocompleteIdentity = style([
  DefaultReset,
  {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: config.space.S100,
    flexGrow: 1,
  },
]);

export const InviteAutocompleteDisplayName = style({
  minWidth: 0,
  overflowWrap: 'anywhere',
});

export const InviteAutocompleteUserId = style({
  minWidth: 0,
  overflowWrap: 'anywhere',
});
