import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { glassSurface } from '../../styles/Glass.css';
import { SectionBody, SectionMeta } from './ThreadApprovals.css';

/**
 * An `io.mindroom.tool_approval` request rendered in the timeline: the same glass card as
 * the thread summary and approval groups, its rim lit at the top and bottom.
 */
export const Card = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  {
    minWidth: 0,
    maxWidth: `min(100%, ${toRem(520)})`,
    paddingBlock: config.space.S300,
    paddingInline: config.space.S300,
    color: color.SurfaceVariant.OnContainer,
    borderRadius: config.radii.R400,
  },
]);

/** Relative request time, set off from the metadata before it by a dot. */
export const MetaDot = style({
  opacity: 0.7,
  selectors: {
    '&::before': {
      content: '"·"',
      marginInline: config.space.S100,
    },
  },
});

// The card's details stack in a column; the request time continues the metadata's line instead of
// starting one of its own, and every other detail still takes a full line.
const detailsWithTime = `${SectionBody}:has(> ${MetaDot})`;
globalStyle(detailsWithTime, { flexDirection: 'row', flexWrap: 'wrap', columnGap: 0 });
globalStyle(`${detailsWithTime} > :not(${SectionMeta}):not(${MetaDot})`, { flexBasis: '100%' });

/** Explains what a timed auto-approval would cover. */
export const Scope = style({
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  backgroundColor: `color-mix(in srgb, ${color.Surface.Container} 70%, transparent)`,
  borderRadius: config.radii.R300,
});
