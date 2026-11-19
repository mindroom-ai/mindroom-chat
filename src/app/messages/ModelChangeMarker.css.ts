import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const Marker = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  minWidth: 0,
});

// The quiet markers' trigger (the thread title's, the skill review's): a muted line that lights
// up on hover, focus or open. Its words wrap on a narrow thread rather than push the row wide.
export const Trigger = style({
  display: 'inline-flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: config.space.S200,
  rowGap: 0,
  minWidth: 0,
  maxWidth: `calc(100% + ${config.space.S100})`,
  border: 0,
  borderRadius: config.radii.R300,
  padding: `${toRem(1)} ${config.space.S100}`,
  marginInlineStart: `calc(-1 * ${config.space.S100})`,
  background: 'transparent',
  color: 'inherit',
  textAlign: 'start',
  transition: 'opacity 120ms ease, color 120ms ease, background-color 120ms ease',
  // folds' muted text level, which keeps 12px text above WCAG AA contrast.
  opacity: config.opacity.P300,
  font: 'inherit',
  cursor: 'pointer',
  selectors: {
    '&:hover, &:focus-visible, &[aria-expanded="true"]': {
      opacity: 1,
      color: color.Primary.Main,
      background: color.Primary.Container,
    },
    '&:focus-visible': {
      outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
      outlineOffset: toRem(1),
    },
  },
});

// The glyph and the chevron keep their size beside words that wrap.
globalStyle(`${Trigger} > svg`, { flexShrink: 0 });

export const Title = style({
  flex: 'none',
});

// What the change chose: the line's one piece of news, so it carries the weight.
export const Model = style({
  minWidth: 0,
  fontWeight: config.fontWeight.W600,
  overflowWrap: 'anywhere',
});

// Who, when and what it covers, under the line and tied to it by a rule at its start.
export const Panel = style({
  display: 'flex',
  flexDirection: 'column',
  gap: toRem(2),
  marginBlockStart: config.space.S100,
  paddingBlock: toRem(2),
  paddingInlineStart: config.space.S200,
  borderInlineStart: `${config.borderWidth.B600} solid ${color.SurfaceVariant.ContainerLine}`,
  minWidth: 0,
  overflowWrap: 'anywhere',
});
