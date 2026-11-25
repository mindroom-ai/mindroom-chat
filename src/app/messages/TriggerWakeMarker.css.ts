import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import * as modelCss from './ModelChangeMarker.css';

export { Marker, Title, Model as Summary } from './ModelChangeMarker.css';

const focusRing = {
  outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
  outlineOffset: toRem(1),
} as const;

// Matches ModelChangeMarker.Trigger geometry while keeping >= 4.5:1 WCAG AA contrast across all 23
// palettes: resting P400 (0.9) is >= 5.35:1 on Surface/SurfaceVariant, and hover/expanded
// Primary.OnContainer on Primary.Container is >= 7.26:1.
export const Trigger = style({
  display: 'inline-flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: config.space.S200,
  rowGap: 0,
  minInlineSize: 0,
  maxInlineSize: `calc(100% + ${config.space.S100})`,
  border: 0,
  borderRadius: config.radii.R300,
  paddingBlock: toRem(1),
  paddingInline: config.space.S100,
  marginInlineStart: `calc(-1 * ${config.space.S100})`,
  background: 'transparent',
  color: 'inherit',
  textAlign: 'start',
  transition: 'opacity 120ms ease, color 120ms ease, background-color 120ms ease',
  opacity: config.opacity.P400,
  font: 'inherit',
  cursor: 'pointer',
  selectors: {
    '&:hover, &:focus-visible, &[aria-expanded="true"]': {
      opacity: 1,
      color: color.Primary.OnContainer,
      background: color.Primary.Container,
    },
    '&:focus-visible': focusRing,
  },
});

globalStyle(`${Trigger} > svg`, { flexShrink: 0 });

export const Panel = style([
  modelCss.Panel,
  {
    gap: config.space.S100,
    alignSelf: 'stretch',
  },
]);

export const PanelHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S200,
  minInlineSize: 0,
});

export const Meta = style({
  minInlineSize: 0,
  overflowWrap: 'anywhere',
});

// Time applies P300 (0.75) opacity on its own; inside Meta (already P400 / 0.9), keep it at 1 so
// opacity does not compound below WCAG AA contrast.
globalStyle(`${Meta} time`, {
  opacity: 1,
});

export const MetaLink = style({
  padding: 0,
  border: 0,
  borderRadius: config.radii.R300,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  textDecoration: 'underline',
  textUnderlineOffset: toRem(2),
  cursor: 'pointer',
  selectors: { '&:focus-visible': focusRing },
});

export const CopyButton = style({
  '@media': { '(pointer: coarse)': { minBlockSize: 44, minInlineSize: 44 } },
  display: 'inline-grid',
  placeItems: 'center',
  flexShrink: 0,
  marginInlineStart: 'auto',
  padding: config.space.S100,
  border: 0,
  borderRadius: config.radii.R300,
  background: 'transparent',
  color: 'inherit',
  opacity: config.opacity.P400,
  cursor: 'pointer',
  transition: 'opacity 120ms ease, color 120ms ease, background-color 120ms ease',
  selectors: {
    '&:hover, &:focus-visible': {
      opacity: 1,
      color: color.Primary.OnContainer,
      background: color.Primary.Container,
    },
    '&:focus-visible': focusRing,
  },
});

export const Prompt = style({
  margin: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});

// Inline links keep the panel's text contrast across every palette; mention pills keep their
// container surface and non-underlined chip styling from CustomHtml.css.
globalStyle(`${Prompt} a:not([class])`, {
  color: 'inherit',
  textDecoration: 'underline',
  textUnderlineOffset: toRem(2),
});

globalStyle(`${Prompt} a:focus-visible`, {
  ...focusRing,
  borderRadius: config.radii.R300,
});

export const InlineCode = style({
  fontFamily: 'var(--font-mono)',
  fontSize: '0.92em',
  paddingBlock: toRem(1),
  paddingInline: config.space.S100,
  borderRadius: config.radii.R300,
  background: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
});

export const Payload = style({
  margin: 0,
  paddingBlock: config.space.S100,
  paddingInline: config.space.S200,
  maxBlockSize: toRem(280),
  overflow: 'auto',
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R300,
  background: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  fontFamily: 'var(--font-mono)',
  fontSize: toRem(12),
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  textAlign: 'start',
  selectors: { '&:focus-visible': focusRing },
});
