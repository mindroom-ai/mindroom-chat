import { globalStyle, style } from '@vanilla-extract/css';
import { config } from 'folds';

// Measured from docs/design/reference/settings.png (1440x900 at 1x), dialog from x = 320 to
// 1120 with the divider at 542: menu rows end 20 px before the divider, the close button sits
// 24 px from the dialog's right edge and the cards end 28 px from it. Right-to-left languages
// mirror all three.

/** The menu column leaves 20 px between its rows and the divider (8 px come from the scroll). */
export const SettingsMenu = style({
  flexGrow: 1,
  paddingInlineEnd: config.space.S300,
});

/** Set on the content of every settings page by SettingsPageFrame. */
const SETTINGS_CARD = '[data-settings-page] [data-sequence-card]';

// The cards of settings.png have the card padding and no rim, also where a page leaves out the
// padding class (the archived rooms list); the padding is the class's value, so both agree.
globalStyle(SETTINGS_CARD, {
  padding: config.space.S300,
  borderColor: 'transparent',
});

// settings.png draws every button in a card with its outline ("Save computer service",
// "Use app default", "Open Connections"), whether or not the button asks for one.
globalStyle(`${SETTINGS_CARD} button:not([role="switch"])`, {
  borderWidth: config.borderWidth.B400,
});

/** A group heading of the menu (You, This app, ...) lines up with the rows' icons. */
export const SettingsMenuGroupLabel = style({
  paddingInline: config.space.S200,
});

// Each group after the first keeps a gap from the one above.
globalStyle(`${SettingsMenu} > [role="group"] + [role="group"]`, {
  marginBlockStart: config.space.S300,
});
