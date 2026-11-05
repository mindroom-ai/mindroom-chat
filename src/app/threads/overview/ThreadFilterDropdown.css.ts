import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// Doubled so it wins over the shared dropdown trigger style it is combined with.
export const TriggerActive = style({
  selectors: {
    '&&': {
      backgroundColor: color.Primary.Container,
      borderColor: color.Primary.ContainerLine,
      color: color.Primary.OnContainer,
    },
    '&&:hover': {
      backgroundColor: color.Primary.ContainerHover,
    },
  },
});

export const Count = style({
  fontVariantNumeric: 'tabular-nums',
});

// The one chosen value the trigger names in place of its label.
export const TriggerValue = style({
  maxWidth: toRem(140),
});

export const Panel = style({
  selectors: { '&&&': { minWidth: toRem(240), maxWidth: toRem(300) } },
  display: 'flex',
  flexDirection: 'column',
  rowGap: config.space.S100,
});

// The search field's colors, and the tones of the labels after an option's name.
const searchField = {
  line: color.SurfaceVariant.ContainerLine,
  surface: color.Background.Container,
  text: color.Background.OnContainer,
};
const markerTone = { surface: color.Secondary.Container, text: color.Secondary.OnContainer };
const excludedTone = { surface: color.Critical.Container, text: color.Critical.OnContainer };

export const Search = style({
  height: toRem(32),
  paddingInline: config.space.S200,
  boxSizing: 'border-box',
  border: `${config.borderWidth.B300} solid ${searchField.line}`,
  borderRadius: config.radii.R300,
  backgroundColor: searchField.surface,
  color: searchField.text,
  font: 'inherit',
  fontSize: toRem(13),
  outline: 'none',
  selectors: {
    '&::placeholder': { color: color.SurfaceVariant.OnContainer, opacity: 0.6 },
    '&:focus-visible': { borderColor: color.Primary.Main },
  },
});

export const List = style({
  maxHeight: toRem(280),
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
});

export const Option = style({
  display: 'flex',
  alignItems: 'center',
  columnGap: config.space.S200,
  paddingBlock: config.space.S100,
  paddingInline: config.space.S200,
  borderRadius: config.radii.R300,
  cursor: 'pointer',
  selectors: {
    '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover },
    '&:focus-within': { backgroundColor: color.SurfaceVariant.ContainerHover },
  },
});

export const Name = style({
  flexGrow: 1,
  minWidth: 0,
});

export const Marker = style({
  flexShrink: 0,
  paddingInline: config.space.S100,
  borderRadius: config.radii.R300,
  backgroundColor: markerTone.surface,
  color: markerTone.text,
});

export const MarkerExcluded = style({
  backgroundColor: excludedTone.surface,
  color: excludedTone.text,
});

// A tag's color, in place of the avatar a person has.
export const Swatch = style({
  flexShrink: 0,
  width: toRem(12),
  height: toRem(12),
  borderRadius: config.radii.Pill,
});

export const OptionCount = style({
  flexShrink: 0,
  opacity: 0.6,
  fontVariantNumeric: 'tabular-nums',
});

export const Empty = style({
  paddingBlock: config.space.S200,
  paddingInline: config.space.S200,
  opacity: 0.7,
});

export const Footer = style({
  display: 'flex',
  justifyContent: 'flex-end',
  paddingBlockStart: config.space.S100,
  borderBlockStart: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

export const Clear = style({
  paddingBlock: config.space.S100,
  paddingInline: config.space.S200,
  border: 'none',
  borderRadius: config.radii.R300,
  background: 'none',
  color: color.Primary.Main,
  font: 'inherit',
  fontSize: toRem(13),
  cursor: 'pointer',
  selectors: {
    '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover },
    '&:focus-visible': { outline: `2px solid ${color.Primary.Main}`, outlineOffset: '-2px' },
  },
});
