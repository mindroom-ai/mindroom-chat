import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { InsetBox, Stack } from './workflowPanel.css';

const { space, radii, borderWidth, fontSize, lineHeight, opacity } = config;
const focusRing = { outline: `2px solid ${color.Primary.Main}`, outlineOffset: 1 } as const;
const smallType = { fontSize: fontSize.T200, lineHeight: lineHeight.T200 } as const;
const flexRow = { display: 'flex', alignItems: 'center' } as const;
const cardOf = (c: typeof color.Surface) => ({
  border: `${borderWidth.B300} solid ${c.ContainerLine}`,
  backgroundColor: c.Container,
  color: c.OnContainer,
});
const surfaceCard = cardOf(color.Surface);
const variantCard = cardOf(color.SurfaceVariant);
const surfaceHover = {
  '&:hover': { backgroundColor: color.Surface.ContainerHover },
  '&:focus-visible': focusRing,
};

export const MessageList = style([Stack, { margin: 0, padding: 0, listStyle: 'none' }]);
export const MessageRow = style({
  ...flexRow,
  justifyContent: 'space-between',
  gap: space.S200,
  padding: `${space.S200} ${space.S300}`,
  borderRadius: radii.R300,
  ...variantCard,
  ...smallType,
});
export const MessageCard = style([
  InsetBox,
  {
    gap: space.S100,
    padding: `${space.S200} ${space.S300}`,
    borderRadius: radii.R300,
    ...smallType,
  },
]);
export const MessageHeader = style({
  ...flexRow,
  justifyContent: 'space-between',
  gap: space.S200,
  minInlineSize: 0,
});
export const MessageRoute = style({
  ...flexRow,
  flexWrap: 'wrap',
  gap: space.S100,
  minInlineSize: 0,
});
export const MessageNodeLink = style({
  padding: 0,
  border: 0,
  backgroundColor: 'transparent',
  color: color.Primary.Main,
  font: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
  borderRadius: radii.R300,
  selectors: { '&:hover': { textDecoration: 'underline' }, '&:focus-visible': focusRing },
});
export const MessageText = style({ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });
export const PeerLinkButton = style({
  ...flexRow,
  ...surfaceCard,
  ...smallType,
  inlineSize: '100%',
  padding: `${space.S100} ${space.S200}`,
  borderRadius: radii.R300,
  textAlign: 'start',
  cursor: 'pointer',
  selectors: surfaceHover,
});
export const PeerMessageCard = style([
  Stack,
  {
    ...surfaceCard,
    ...smallType,
    gap: toRem(2),
    inlineSize: '100%',
    padding: `${space.S100} ${space.S200}`,
    borderRadius: radii.R300,
    textAlign: 'start',
  },
]);
export const PeerMessageButton = style([
  PeerMessageCard,
  { cursor: 'pointer', selectors: surfaceHover },
]);
export const MessagePreview = style({
  display: '-webkit-box',
  overflow: 'hidden',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  opacity: opacity.P400,
});
