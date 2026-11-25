import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

/** Subtle section icon leading the chevron in Home's Direct messages and Agents headers. */
export const SectionIcon = style({
  opacity: config.opacity.P500,
  flexShrink: 0,
});

/** Small green dot on the bottom-end corner of an agent avatar while the agent has an active run. */
export const AgentActiveRunDot = style({
  position: 'absolute',
  insetInlineEnd: toRem(-2),
  insetBlockEnd: toRem(-2),
  inlineSize: toRem(8),
  blockSize: toRem(8),
  borderRadius: config.radii.Pill,
  backgroundColor: color.Success.Main,
  boxShadow: `0 0 0 ${toRem(1.5)} ${color.Background.Container}`,
  pointerEvents: 'none',
  '@media': {
    '(forced-colors: active)': {
      border: '2px solid Highlight',
    },
  },
});

/** Inline error text shown below an agent row if starting its direct chat fails. */
export const AgentStartError = style({
  color: color.Critical.Main,
  paddingInlineStart: toRem(36),
  paddingInlineEnd: config.space.S200,
  paddingBlockStart: config.space.S100,
  margin: 0,
});

/** Full-width search field at the top of populated Home, spaced by the parent column gap. */
export const PopulatedSearchField = style({
  inlineSize: '100%',
});
