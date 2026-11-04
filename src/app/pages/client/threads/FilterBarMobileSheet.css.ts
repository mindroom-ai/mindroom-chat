import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { Bar } from './FilterBar.css';

/** Pins the filters sheet to the bottom edge of the screen. */
export const SheetContainer = style({
  position: 'fixed',
  insetInline: 0,
  bottom: 0,
  display: 'flex',
  justifyContent: 'center',
});

export const SheetBody = style({
  display: 'flex',
  flexDirection: 'column',
  // Options keep their own width; the panel shows beside them, as under the title.
  alignItems: 'flex-start',
  gap: config.space.S400,
  padding: `${config.space.S300} ${config.space.S400}`,
  // Clear of the home indicator at the bottom of a phone.
  paddingBottom: `calc(${config.space.S400} + env(safe-area-inset-bottom, 0px))`,
});

// The sheet's title lines up with the filters under it; its close button keeps to the corner.
globalStyle(`${SheetContainer} header`, {
  paddingInlineStart: config.space.S400,
  paddingInlineEnd: config.space.S200,
});

// The filter bar's own controls are native: give its dropdowns and check boxes the look of the
// fields beside them, under the title and in this sheet alike.
const filterAreas = [Bar, SheetBody];

filterAreas.forEach((area) => {
  globalStyle(`${area} select`, {
    // As tall as the text fields of the bar (folds Input, size 400).
    blockSize: toRem(40),
    paddingInline: config.space.S300,
    color: color.Background.OnContainer,
    fontSize: toRem(13),
    backgroundColor: color.Background.Container,
    border: `${config.borderWidth.B300} solid transparent`,
    borderRadius: config.radii.R300,
    cursor: 'pointer',
  });
  globalStyle(`${area} select:hover`, { backgroundColor: color.Background.ContainerHover });
  globalStyle(`${area} select:focus-visible`, {
    outline: `${config.borderWidth.B600} solid ${color.Primary.ContainerLine}`,
    outlineOffset: 0,
  });
  globalStyle(`${area} input[type='checkbox']`, {
    inlineSize: toRem(16),
    blockSize: toRem(16),
    accentColor: color.Primary.Main,
    margin: 0,
    cursor: 'pointer',
  });
});
