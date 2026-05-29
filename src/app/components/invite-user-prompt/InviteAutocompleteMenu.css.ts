import { style } from '@vanilla-extract/css';
import { DefaultReset, config, toRem } from 'folds';

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
    maxHeight: `min(52vh, ${toRem(448)})`,
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
