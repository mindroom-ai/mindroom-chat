import { globalStyle, keyframes, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// The settings dialogs take the look of a compact desktop preferences window: a wide dialog, a
// menu of 32 px rows under a search field, a thin title bar with the page's place in the dialog,
// and a centered column of sections whose settings are rows of one card, apart by their padding.
// Right-to-left languages mirror all of it.

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

// The pages the menu does not show read quieter; the one under the pointer or the keyboard's
// focus and the open one are in full color. At 0.7 the names keep 4.5:1 on the light glass.
globalStyle(`${SettingsMenu} button:not(:hover, :focus-visible, [aria-pressed="true"]) > *`, {
  opacity: 0.7,
});

/**
 * A row of a settings menu (and of the search results and Logout): 32 px tall and 4 px from the
 * next, 10 px from its edge to the icon and 8 px from the icon to the name. The keyboard's focus
 * ring is drawn inside the row, so it never covers the rows beside it.
 */
export const SettingsMenuRow = style({
  selectors: {
    '&&': {
      paddingInline: toRem(10),
      gap: config.space.S200,
    },
    '& + &': {
      marginBlockStart: config.space.S100,
    },
    '&&:focus-visible': {
      outlineOffset: `calc(-1 * ${config.borderWidth.B600})`,
    },
  },
});

/**
 * A group heading of the menu (You, This app, ...), quiet, starting where the rows' icons do: its
 * row's own 4 px and these 6 px make the rows' 10 px.
 */
export const SettingsMenuGroupLabel = style({
  paddingInline: toRem(6),
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
const SETTINGS_PAGE = '[data-settings-page]';
const SETTINGS_CARD = `${SETTINGS_PAGE} [data-sequence-card]`;

// A section's settings are the rows of one card: the rows hold the padding, so space alone
// (24 px between two rows) sets them apart, with no line between them.
globalStyle(SETTINGS_CARD, {
  padding: 0,
  gap: 0,
});
globalStyle(`${SETTINGS_CARD} > *`, {
  paddingBlock: config.space.S300,
  paddingInline: config.space.S400,
});

// A section's heading is whatever stands right before its card, the card's own title included;
// it starts where the rows' text does.
globalStyle(`${SETTINGS_PAGE} :not([data-sequence-card]):has(+ [data-sequence-card])`, {
  fontSize: toRem(15),
  lineHeight: toRem(22),
  fontWeight: config.fontWeight.W600,
  paddingInline: config.space.S400,
  marginBlockEnd: config.space.S200,
});

// settings.png draws every button in a card with its outline ("Save computer service",
// "Use app default", "Open Connections"), whether or not the button asks for one.
globalStyle(`${SETTINGS_CARD} button:not([role="switch"])`, {
  borderWidth: config.borderWidth.B400,
});

// A search result's setting glows once in the primary color when its page brings it into view,
// within its row: rows reach the card's rim, so a glow around them would spill over it.
const settingFound = keyframes({
  from: { backgroundColor: color.Primary.Container },
  to: { backgroundColor: 'transparent' },
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
