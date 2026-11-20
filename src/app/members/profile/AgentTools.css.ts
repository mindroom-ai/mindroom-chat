import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const ICON = toRem(20);

/** The agent's card: wider than a person's for its tool rows, and never taller than the window. */
export const AgentCard = style({
  inlineSize: toRem(340),
  maxInlineSize: '100%',
  maxBlockSize: `calc(100dvh - ${toRem(32)})`,
  overflowY: 'auto',
  padding: config.space.S400,
  '@media': { '(max-width: 750px)': { inlineSize: 'auto', paddingBlockStart: 0 } },
});

export const Section = style({
  borderBlockStart: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  paddingBlockStart: config.space.S300,
});

/** A row of configured tools: its icon, a title over example tools or a description, a count. */
export const Row = style({
  display: 'grid',
  gridTemplateColumns: `${ICON} 1fr auto`,
  columnGap: config.space.S300,
  alignItems: 'start',
});

export const Wrap = style({ overflowWrap: 'anywhere' });

/** What follows the rows starts where the rows' titles do. */
export const Indented = style({ paddingInlineStart: `calc(${ICON} + ${config.space.S300})` });

// Primary's Main falls just under 4.5:1 on some light backgrounds; MainActive keeps it in every theme.
export const ViewAll = style({ color: color.Primary.MainActive, paddingInline: 0 });

/** The full list scrolls on its own, so the Message button stays in view under it. */
export const ToolList = style({
  maxBlockSize: `min(${toRem(360)}, 50dvh)`,
  overflowY: 'auto',
});

// Both scroll instead of squeezing what they hold.
globalStyle(`${AgentCard} > *, ${ToolList} > *`, { flexShrink: 0 });

/** A group's icon, beside the first line of what it heads. */
export const GroupIcon = style({ flexShrink: 0, marginBlockStart: toRem(2) });
