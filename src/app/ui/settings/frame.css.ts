import { globalStyle, keyframes, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// The settings dialogs take the look of a compact desktop preferences window: a wide dialog, a
// menu of 32 px rows under a search field, a thin title bar with the page's place in the dialog,
// and a centered column of sections whose settings are rows of one card, apart by their padding.
// Right-to-left languages mirror all of it.
//
// The Settings dialog keeps one inset, 12 px (S300). The search field, the menu's rows, the search
// results and Logout stay that far from the dialog's edges and from the divider; so do the page's
// close button and, on a phone, the menu's title and its close button. The icons and the group
// headings start 8 px (S200) further in, 20 px from the column's edge, as the close button's icon
// does from the end edge; the page's breadcrumb starts where its sections' text does
// (SettingsPageFrame). Between the field and the first group, between the groups and above Logout
// the menu keeps the inset as well.

/** The dialog's inset. */
const INSET = config.space.S300;

/** The search field's height (folds size 300), which the close button beside it shares. */
const CONTROL_HEIGHT = toRem(32);

/**
 * The height of the desktop dialogs' two title bars, the search field's (or a room's name) on top
 * of the menu and the page's beside it, so they, the page's title and the close button share one
 * line. Only the dialogs on wider screens set it; phones keep their 48 and 54 px bars.
 */
const BAR_HEIGHT = '--mr-settings-bar-height';

/** The search field with the inset above and below it: 56 px. */
const BAR = `calc(${CONTROL_HEIGHT} + 2 * ${INSET})`;

/**
 * About 1000 by 740 px, tall enough for the whole menu with Local MindRoom (14 rows in 5 groups),
 * and a margin smaller than that where the window is. Its title bars keep the 32 px search field
 * and close button the inset from the dialog's top edge.
 */
export const SettingsDialog = style({
  vars: { [BAR_HEIGHT]: BAR },
  selectors: {
    '&&': {
      maxWidth: `min(${toRem(1000)}, calc(100% - 2 * ${config.space.S400}))`,
      maxHeight: `min(${toRem(740)}, calc(100% - 2 * ${config.space.S400}))`,
    },
  },
});

/** A room's (or space's) settings dialog keeps its size and takes the same title bars. */
export const RoomSettingsDialog = style({
  vars: { [BAR_HEIGHT]: BAR },
});

/** On wider screens a room's name over its settings menu, as tall as the page's title bar. */
export const RoomSettingsMenuTitle = style({
  selectors: {
    '&&': { height: BAR },
  },
});

/**
 * The menu column's rows keep the inset from the dialog's edge and from the divider: 8 px from the
 * scrolling list's own padding and these 4 px, so the open page's fill sits evenly in the column.
 */
export const SettingsMenu = style({
  flexGrow: 1,
  paddingInline: config.space.S100,
});

// The pages the menu does not show read quieter; the one under the pointer or the keyboard's
// focus and the open one are in full color. At 0.7 the names keep 4.5:1 on the light glass.
globalStyle(`${SettingsMenu} button:not(:hover, :focus-visible, [aria-pressed="true"]) > *`, {
  opacity: 0.7,
});

/**
 * A row of a settings menu (and of the search results and Logout): 32 px tall and 4 px from the
 * next, 8 px from its edge to the icon, as in the search field, and 8 px from the icon to the name.
 * The keyboard's focus ring is drawn inside the row, so it never covers the rows beside it.
 */
export const SettingsMenuRow = style({
  selectors: {
    '&&': {
      paddingInline: config.space.S200,
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
 * row's own 4 px and these 4 px make the rows' 8 px.
 */
export const SettingsMenuGroupLabel = style({
  paddingInline: config.space.S100,
});

/**
 * A group of the menu: its heading sits right on its rows, and the inset parts it from the group
 * above (the first group has the search field's bar above it).
 */
export const SettingsMenuGroup = style({
  selectors: {
    '& + &': { paddingBlockStart: INSET },
  },
});

/** The menu's list starts right under the search field's bar and ends the inset above Logout. */
export const SettingsMenuList = style({
  selectors: {
    '&&': { paddingBlock: `0 ${INSET}` },
  },
});

/** A phone's menu title bar: its close button keeps the inset from the end edge. */
export const SettingsMenuTitle = style({
  selectors: {
    '&&': { paddingInlineEnd: INSET },
  },
});

/**
 * The search field on top of the menu, aligned with its rows (the inset from either side) and with
 * the inset above and below it, so on wider screens it is as tall as the page's title bar beside it.
 */
export const SettingsSearchHeader = style({
  selectors: {
    '&&': {
      height: BAR,
      paddingInline: INSET,
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

/** The list of search results that takes the menu's place, as wide as the menu's rows. */
export const SettingsSearchResults = style({
  paddingInline: config.space.S100,
});

// The result Enter would open looks like the menu's current page.
globalStyle(`${SettingsSearchResults} > [aria-selected="true"]`, {
  backgroundColor: color.Background.ContainerActive,
});

/** The page (and group) a search result lives on, under its label. */
export const SettingsSearchLocation = style({
  display: 'block',
});

/** Sign out, under the menu and in line with its rows, the inset from the bottom edge, in red. */
export const SettingsMenuFooter = style({
  flexShrink: 0,
  paddingBlockEnd: INSET,
  paddingInline: INSET,
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

// A section's heading, which its component marks with data-settings-heading, starts where the
// rows' text does. Only the mark makes a heading: the section in front of a card that is still
// loading stays as it is.
globalStyle(`${SETTINGS_PAGE} [data-settings-heading]`, {
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
