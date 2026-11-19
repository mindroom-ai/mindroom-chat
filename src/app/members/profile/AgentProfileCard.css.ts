import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

/** The agent's card: wider than a person's for its tool rows, and never taller than the window. */
export const AgentCard = style({
  inlineSize: toRem(340),
  maxInlineSize: '100%',
  maxBlockSize: `calc(100dvh - ${toRem(32)})`,
  overflowY: 'auto',
  padding: config.space.S400,
  '@media': { '(max-width: 750px)': { inlineSize: 'auto', paddingBlockStart: 0 } },
});

export const AgentBadge = style({
  flexShrink: 0,
  padding: `0 ${config.space.S200}`,
  borderRadius: config.radii.Pill,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  color: color.SurfaceVariant.OnContainer,
});

export const Section = style({
  borderBlockStart: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  paddingBlockStart: config.space.S300,
});

/** A row of what the agent can do: its icon, a title over example tools, and a count. */
export const CapabilityRow = style({
  display: 'grid',
  gridTemplateColumns: `${toRem(28)} 1fr auto`,
  columnGap: config.space.S300,
  alignItems: 'start',
});

export const CapabilityIcon = style({
  display: 'grid',
  placeItems: 'center',
  inlineSize: toRem(28),
  blockSize: toRem(28),
  borderRadius: config.radii.R300,
  background: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
});

/** Text under a row's title: example tools or a tool's description, cut to two lines. */
export const CapabilityDetail = style({
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  overflow: 'hidden',
  overflowWrap: 'anywhere',
});

/** The "View all" link and the rows of the full list start where the rows' titles do. */
export const Indented = style({
  paddingInlineStart: `calc(${toRem(28)} + ${config.space.S300})`,
});

export const LinkButton = style({
  all: 'unset',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  color: color.Primary.Main,
  borderRadius: config.radii.R300,
  selectors: { '&:focus-visible': { outline: `2px solid ${color.Primary.Main}` } },
});

/** The full list scrolls on its own, so the Message button stays in view under it. */
export const ToolList = style({
  maxBlockSize: `min(${toRem(360)}, 50dvh)`,
  overflowY: 'auto',
});

export const ToolGroupIcon = style({
  flexShrink: 0,
  marginBlockStart: toRem(2),
});

export const RoomChip = style({
  maxInlineSize: toRem(140),
});

export const RoomChipAvatar = style({
  inlineSize: toRem(16),
  blockSize: toRem(16),
  fontSize: toRem(10),
});

// Both scroll instead of squeezing what they hold.
globalStyle(`${AgentCard} > *, ${ToolList} > *`, { flexShrink: 0 });
