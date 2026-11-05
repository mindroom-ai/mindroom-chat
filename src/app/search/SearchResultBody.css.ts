import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// A matched word in a search result. The browser's own `mark` paints pure yellow with black text,
// which glares on the dark themes; the Warning container tones keep the amber hint in every theme.
export const SearchMatch = style({
  backgroundColor: color.Warning.Container,
  color: color.Warning.OnContainer,
  boxShadow: `inset 0 0 0 ${config.borderWidth.B300} ${color.Warning.ContainerLine}`,
  borderRadius: config.radii.R300,
  padding: `0 ${toRem(2)}`,
});
