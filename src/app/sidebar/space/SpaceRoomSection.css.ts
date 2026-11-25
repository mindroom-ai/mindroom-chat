import { style } from '@vanilla-extract/css';
import { config, toRem } from 'folds';

/** Tight vertical stack for space sections (~28px collapsed pitch instead of 44px). */
export const SpaceSectionStack = style({
  display: 'flex',
  flexDirection: 'column',
  gap: toRem(2),
});

/** Top-level expanded spaces breathe below while collapsed spaces stay compact. */
export const SpaceSectionNode = style({
  selectors: {
    '&[data-depth="0"][data-expanded="true"]': {
      marginBlockEnd: config.space.S200,
    },
    '&[data-depth="0"][data-expanded="true"]:last-child': {
      marginBlockEnd: 0,
    },
  },
});

/** Indented tree block with a subtle inline-start guide for a space's rooms and sub-spaces. */
export const NestedChildren = style({
  marginInlineStart: toRem(11),
  paddingInlineStart: toRem(8),
  borderInlineStart: '1px solid color-mix(in srgb, currentColor 12%, transparent)',
  display: 'flex',
  flexDirection: 'column',
  gap: toRem(1),
});
