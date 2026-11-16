import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

// Shaped as the timeline's date dividers: a label between two hairlines.
export const Divider = style({
  display: 'grid',
  gridTemplateColumns: '1fr minmax(0, auto) 1fr',
  alignItems: 'center',
  columnGap: config.space.S200,
  paddingBlock: config.space.S200,
  paddingInline: config.space.S400,
  color: color.SurfaceVariant.OnContainer,
});

export const Rule = style({
  height: 1,
  background: color.SurfaceVariant.ContainerLine,
});

// The label's own line: the icon and the text, as the link shows them.
export const Label = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
  paddingBlock: config.space.S100,
  paddingInline: config.space.S200,
});

export const Link = style([
  Label,
  {
    border: 'none',
    borderRadius: config.radii.R300,
    background: 'none',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
    selectors: {
      '&:hover, &:focus-visible': {
        color: color.Primary.Main,
        backgroundColor: color.SurfaceVariant.ContainerHover,
      },
    },
  },
]);
