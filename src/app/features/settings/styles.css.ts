import { globalStyle, style } from '@vanilla-extract/css';
import { config } from 'folds';

/** Spacing for the cards that group setting tiles on every settings page. */
export const SequenceCardStyle = style({
  padding: config.space.S300,
  // The cards of settings.png have no rim; the doubled class outranks the card's own border.
  selectors: { '&&': { borderColor: 'transparent' } },
});

// settings.png draws every button in a card with its outline ("Save computer service",
// "Use app default", "Open Connections"), whether or not the button asks for one.
globalStyle(`${SequenceCardStyle} button:not([role="switch"])`, {
  borderWidth: config.borderWidth.B400,
});
