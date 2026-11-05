import { globalStyle, keyframes, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// The settings dialogs take the look of a compact desktop preferences window: a wide dialog, a
// menu of 32 px rows under a search field, and a thin title bar with the page's place in the
// dialog. Right-to-left languages mirror all of it.

/** About 1000 by 700 px, and a margin smaller than that where the window is. */
export const SettingsDialog = style({
  selectors: {
    '&&': {
      maxWidth: `min(${toRem(1000)}, calc(100% - 2 * ${config.space.S400}))`,
      maxHeight: `min(${toRem(700)}, calc(100% - 2 * ${config.space.S400}))`,
    },
  },
});

/** The menu column leaves 20 px between its rows and the divider (8 px come from the scroll). */
export const SettingsMenu = style({
  flexGrow: 1,
  paddingInlineEnd: config.space.S300,
});

/** A group heading of the menu (You, This app, ...), quiet and in the rows' icon column. */
export const SettingsMenuGroupLabel = style({
  paddingInline: config.space.S200,
});

/**
 * The search field on top of the menu, aligned with its rows (8 px in, 20 px from the divider)
 * and as tall as the page's title bar beside it.
 */
export const SettingsSearchHeader = style({
  selectors: {
    '&&': {
      height: toRem(48),
      paddingInlineStart: config.space.S200,
      paddingInlineEnd: config.space.S500,
    },
  },
});

/** The `/` key cap at the end of the empty search field. */
export const SettingsSearchKey = style({
  direction: 'ltr',
  display: 'inline-grid',
  placeItems: 'center',
  minInlineSize: toRem(20),
  blockSize: toRem(20),
  paddingInline: toRem(4),
  borderRadius: config.radii.R300,
  boxShadow: `inset 0 0 0 ${config.borderWidth.B300} ${color.Background.ContainerLine}`,
  color: color.Background.OnContainer,
  font: 'inherit',
  fontSize: toRem(12),
  lineHeight: 1,
  opacity: 0.8,
});

/** The list of search results that takes the menu's place, ending where the menu's rows do. */
export const SettingsSearchResults = style({
  paddingInlineEnd: config.space.S300,
});

// The result Enter would open looks like the menu's current page.
globalStyle(`${SettingsSearchResults} > [aria-selected="true"]`, {
  backgroundColor: color.Background.ContainerActive,
});

/** The page (and group) a search result lives on, under its label. */
export const SettingsSearchLocation = style({
  display: 'block',
});

/** Sign out, under the menu and in line with its rows, in the danger color. */
export const SettingsMenuFooter = style({
  flexShrink: 0,
  paddingBlock: config.space.S200,
  paddingInlineStart: config.space.S200,
  paddingInlineEnd: config.space.S500,
});
globalStyle(`${SettingsMenuFooter} > button`, { color: color.Critical.Main });

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

// A search result's setting glows once in the primary color when its page brings it into view.
const settingFound = keyframes({
  from: {
    backgroundColor: color.Primary.Container,
    boxShadow: `0 0 0 ${toRem(6)} ${color.Primary.Container}`,
  },
  to: { backgroundColor: 'transparent', boxShadow: `0 0 0 ${toRem(6)} transparent` },
});

globalStyle('[data-setting-id][data-settings-highlight]', {
  borderRadius: config.radii.R300,
  animation: `${settingFound} 2s ease-out`,
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animation: 'none',
      outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
      outlineOffset: toRem(4),
    },
  },
});
