import { globalStyle, style } from '@vanilla-extract/css';
import { config } from 'folds';

// An icon and its words that stay together on one line, as quiet as the description they end.
const iconBesideText = { display: 'inline-flex', alignItems: 'center', gap: config.space.S100 };
const quietUnit = { whiteSpace: 'nowrap', verticalAlign: 'bottom', opacity: 0.8 } as const;

/** Where a setting applies, at the end of the setting's description line. */
export const ScopeLabel = style([iconBesideText, quietUnit]);

/** A setting's description line; a tile with neither a description nor a scope shows none. */
export const ScopeLine = style({ selectors: { '&:empty': { display: 'none' } } });

// The gap after the description wraps away with it: a margin before the scope would indent the
// scope on a line of its own.
globalStyle(`${ScopeLine} > :first-child:not(:last-child)`, {
  marginInlineEnd: config.space.S300,
});
