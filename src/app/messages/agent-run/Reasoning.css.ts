import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

/** The reasoning line above an agent reply: a toggle and, under it, the segments at the top. */
export const Reasoning = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  marginBottom: config.space.S100,
});

/** The toggle and, while the reply's tool calls are hidden, its cog (ToolCallsFold.tsx) after it. */
export const Line = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: config.space.S300,
  minWidth: 0,
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
    [`${Line} > &`]: { alignSelf: 'center' },
  },
});

/** The bulb's box, which the comet of live reasoning laps (OutlineComet.tsx) while the model thinks. */
export const BulbIcon = style({
  position: 'relative',
  display: 'flex',
  flexShrink: 0,
});

/** Dim while the model thinks, so the comet on its outline stands out, as the cog's gear is. */
export const Bulb = style({
  '@media': {
    '(prefers-reduced-motion: no-preference)': {
      transition: 'opacity 300ms ease',
      selectors: { [`${BulbIcon}[data-thinking] &`]: { opacity: 0.42 } },
    },
  },
});

/** The cog of a reply without reasoning, alone at the top of the reply where the toggle goes. */
export const CogRow = style({
  display: 'flex',
  marginBottom: config.space.S100,
});

/** Under an open segment, a chevron up and "Hide thinking", in the header's tone, at its edge. */
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

/** One reasoning segment where it happened: its rail, then its label, text and end button. */
export const Segment = style({
  display: 'flex',
  minWidth: 0,
  marginBlock: config.space.S100,
});

/**
 * The line along a segment, at the text edge, with the gap to the text: a button that hides the
 * thinking while the bulb is open, and lights up under the pointer.
 */
export const Rail = style({
  display: 'flex',
  flexShrink: 0,
  inlineSize: `calc(${config.borderWidth.B400} + ${config.space.S300})`,
  padding: 0,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  '::before': {
    content: '""',
    inlineSize: config.borderWidth.B400,
    borderRadius: config.borderWidth.B400,
    background: color.SurfaceVariant.ContainerLine,
  },
  selectors: {
    '&:focus-visible::before': { background: color.Primary.Main },
  },
  '@media': {
    '(hover: hover)': {
      selectors: { '&:hover::before': { background: color.Primary.Main } },
    },
    '(prefers-reduced-motion: no-preference)': {
      selectors: { '&::before': { transition: 'background 150ms ease' } },
    },
  },
});

export const Body = style({
  flexGrow: 1,
  minWidth: 0,
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
