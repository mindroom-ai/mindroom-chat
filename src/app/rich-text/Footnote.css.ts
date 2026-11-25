import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { MarginSpaced } from './CustomHtml.css';

const CHIP_RADIUS = config.radii.R300;

const FootnoteFocus = style({
  selectors: {
    '&:focus-visible': {
      outline: `${config.borderWidth.B600} solid ${color.Other.FocusRing}`,
      outlineOffset: toRem(1),
    },
  },
});

export const FootnoteRef = style({
  fontSize: '0.75em',
  lineHeight: 0,
  verticalAlign: 'super',
  marginInlineStart: toRem(1),
});

export const FootnoteRefLink = style([
  FootnoteFocus,
  {
    color: color.Primary.OnContainer,
    backgroundColor: color.Primary.Container,
    paddingInline: toRem(3),
    borderRadius: CHIP_RADIUS,
    fontWeight: config.fontWeight.W500,
    textDecoration: 'none',
    selectors: {
      '&:hover': { backgroundColor: color.Primary.ContainerHover, textDecoration: 'underline' },
      '&[data-footnote-highlight]': {
        boxShadow: `0 0 0 ${config.borderWidth.B600} ${color.Primary.Main}`,
      },
    },
  },
]);

export const FootnotesSep = style({
  border: 0,
  borderBlockStart: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  marginBlock: `${config.space.S300} ${config.space.S200}`,
});

export const Footnotes = style([
  MarginSpaced,
  {
    fontSize: '0.875em',
    lineHeight: 1.45,
    color: `color-mix(in srgb, ${color.Surface.OnContainer} 82%, transparent)`,
  },
]);

export const FootnoteItem = style([
  FootnoteFocus,
  {
    borderRadius: CHIP_RADIUS,
    padding: `${toRem(2)} ${config.space.S100}`,
    marginBlock: toRem(2),
    selectors: {
      '&:focus:not(:focus-visible)': { outline: 'none' },
      '&[data-footnote-highlight]': {
        color: color.Primary.OnContainer,
        backgroundColor: color.Primary.Container,
        boxShadow: `inset 0 0 0 ${config.borderWidth.B300} ${color.Primary.ContainerLine}`,
      },
    },
  },
]);

export const FootnoteBackref = style([
  FootnoteFocus,
  {
    marginInlineStart: config.space.S100,
    paddingInline: toRem(3),
    borderRadius: CHIP_RADIUS,
    color: color.Primary.OnContainer,
    textDecoration: 'none',
    opacity: 0.8,
    selectors: {
      '&:hover': { opacity: 1, backgroundColor: color.Primary.Container },
    },
  },
]);
