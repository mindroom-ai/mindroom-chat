import { style } from '@vanilla-extract/css';
import { DefaultReset, config } from 'folds';

export const InviteAutocompleteMenuRoot = style([
  DefaultReset,
  {
    position: 'relative',
  },
]);

export const InviteAutocompleteMenuAnchor = style([
  DefaultReset,
  {
    position: 'relative',
  },
]);

export const InviteAutocompleteMenuContainer = style([
  DefaultReset,
  {
    position: 'absolute',
    top: config.space.S200,
    left: 0,
    right: 0,
    zIndex: config.zIndex.Max,
  },
]);

export const InviteAutocompleteMenu = style([
  DefaultReset,
  {
    maxHeight: '30vh',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
]);

export const InviteAutocompleteMenuHeader = style([
  DefaultReset,
  { padding: `0 ${config.space.S300}`, flexShrink: 0 },
]);
