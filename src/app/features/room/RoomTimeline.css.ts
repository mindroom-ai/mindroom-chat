import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';

/** A control that hovers over the timeline, centered at its top or bottom edge. */
export const TimelineFloat = recipe({
  base: {
    position: 'absolute',
    insetInline: 0,
    marginInline: 'auto',
    width: 'max-content',
    maxWidth: `calc(100% - ${config.space.S400} * 2)`,
    zIndex: 2,
    display: 'flex',
    gap: config.space.S200,
    pointerEvents: 'auto',
  },
  variants: {
    position: {
      Top: { top: config.space.S300 },
      Bottom: { bottom: config.space.S400 },
    },
  },
  defaultVariants: { position: 'Top' },
});

/** The row that holds the expand-all toggle, right-aligned above the rows. */
export const ExpandAllRow = style({
  display: 'flex',
  justifyContent: 'flex-end',
  padding: `${config.space.S100} ${config.space.S400} 0`,
});

/** "[+all]" / "[-all]": a small bracketed toggle that unfolds or folds every long message. */
export const ExpandAllToggle = style({
  all: 'unset',
  cursor: 'pointer',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: toRem(12),
  lineHeight: toRem(18),
  padding: `0 ${config.space.S100}`,
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid ${color.Primary.ContainerLine}`,
  color: color.Primary.Main,
  selectors: {
    '&:hover': { backgroundColor: color.Primary.Container },
    '&:focus-visible': { outline: `2px solid ${color.Primary.Main}`, outlineOffset: 1 },
  },
});

/** A date or unread separator between rows: a label between two hairlines. */
export const TimelineDivider = style({
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  columnGap: config.space.S200,
  placeItems: 'center stretch',
  paddingBlock: config.space.S200,
  paddingInline: config.space.S400,
  color: color.SurfaceVariant.OnContainer,
});

/** One of the two hairlines beside a divider label. */
export const DividerRule = style({
  blockSize: config.borderWidth.B300,
  background: color.SurfaceVariant.ContainerLine,
});

/** The unread separator and its hairlines take the accent color. */
export const UnreadDivider = style({ color: color.Success.Main });
export const UnreadDividerRule = style({ background: color.Success.ContainerLine });
