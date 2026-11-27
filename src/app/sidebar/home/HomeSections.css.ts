import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { CategoryButton } from '../room-nav/RoomNavCategoryButton.css';

/** Subtle muted icon inside Home's compact section cap toggle row (`Show all` / `Show less`). */
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

/** Top divider separating Home's secondary sections (Direct messages, Agents, Threads) from rooms/spaces. */
export const SecondarySectionGroup = style({
  borderBlockStart: '1px solid color-mix(in srgb, currentColor 10%, transparent)',
  paddingBlockStart: config.space.S200,
});

/**
 * Cap collapsed category touch-target vertical reach inside the 2px secondary stack (matching
 * SpaceSectionHeader.css.ts) so Threads' ::after hit area cannot overlap collapsed Agents above it.
 * Repeating CategoryButton via :is() gives (0,4,1) specificity, beating CategoryButton's (0,3,1)
 * touchTarget rule regardless of CSS chunk order.
 */
globalStyle(
  `${SecondarySectionGroup} ${CategoryButton}:is(${CategoryButton})[aria-expanded="false"]::after`,
  {
    '@media': {
      '(pointer: coarse)': {
        insetBlock: 'min(0px, max(calc((100% - 44px) / 2), -1px))',
      },
    },
  }
);
