import { style } from '@vanilla-extract/css';
import { config } from 'folds';

// Measured from docs/design/reference/settings.png (1440x900 at 1x), dialog from x = 320 to
// 1120 with the divider at 542: menu rows end 20 px before the divider, the close button sits
// 24 px from the dialog's right edge and the cards end 28 px from it.

/** The menu column leaves 20 px between its rows and the divider (8 px come from the scroll). */
export const SettingsMenu = style({
  flexGrow: 1,
  paddingRight: config.space.S300,
});
