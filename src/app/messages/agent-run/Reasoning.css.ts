import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

/** The model's reasoning above an agent reply: a toggle and, when open, the reasoning text. */
export const Reasoning = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  marginBottom: config.space.S100,
});

/**
 * A bulb, the label and a chevron, in the tone of the tool row's detail text below it. The bulb
 * starts at the text edge, where the tool row's icon tile starts, and the row is 24 px tall.
 */
export const Toggle = style({
  display: 'inline-flex',
  alignItems: 'center',
  columnGap: '0.25rem',
  alignSelf: 'flex-start',
  padding: `${toRem(1)} 0`,
  color: 'inherit',
  background: 'none',
  border: 'none',
  font: 'inherit',
  opacity: 0.9,
  cursor: 'pointer',
  selectors: {
    '&:hover, &:focus-visible, &[aria-expanded="true"]': {
      opacity: 1,
    },
  },
});

/** Under open reasoning, a chevron up and "Collapse", in the header's tone, at its edge. */
export const CollapseEnd = style([
  Toggle,
  {
    marginTop: config.space.S100,
  },
]);

export const Label = style({
  fontSize: toRem(12),
});

/** Points along the text while collapsed (right, or left in right-to-left), down while open. */
export const Chevron = style({
  flexShrink: 0,
  selectors: {
    '[dir=rtl] &': { transform: 'rotate(180deg)' },
    [`${Toggle}[aria-expanded="true"] &`]: { transform: 'rotate(90deg)' },
  },
  '@media': {
    '(prefers-reduced-motion: no-preference)': { transition: 'transform 150ms ease' },
  },
});

export const Body = style({
  minWidth: 0,
  paddingInlineStart: config.space.S300,
  borderInlineStart: `${config.borderWidth.B400} solid ${color.SurfaceVariant.ContainerLine}`,
  color: color.SurfaceVariant.OnContainer,
  opacity: 0.8,
  fontSize: toRem(14),
});

/** Tool names in the live activity line. */
export const ActivityCode = style({
  fontFamily: 'monospace',
  fontSize: '0.9em',
  padding: `0 ${toRem(3)}`,
  borderRadius: config.radii.R300,
  background: color.SurfaceVariant.Container,
});
