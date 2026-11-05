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

export const Panel = style({
  selectors: { '&&&': { minWidth: toRem(240), maxWidth: toRem(300) } },
  display: 'flex',
  flexDirection: 'column',
  rowGap: config.space.S100,
});

// The search field's and the agent label's colors.
const searchField = {
  line: color.SurfaceVariant.ContainerLine,
  surface: color.Background.Container,
  text: color.Background.OnContainer,
};
const agentTone = { surface: color.Secondary.Container, text: color.Secondary.OnContainer };

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

export const Person = style({
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

export const AgentLabel = style({
  flexShrink: 0,
  paddingInline: config.space.S100,
  borderRadius: config.radii.R300,
  backgroundColor: agentTone.surface,
  color: agentTone.text,
});

export const ThreadCount = style({
  flexShrink: 0,
  opacity: 0.6,
  fontVariantNumeric: 'tabular-nums',
});

export const Empty = style({
  paddingBlock: config.space.S200,
  paddingInline: config.space.S200,
  opacity: 0.7,
});
