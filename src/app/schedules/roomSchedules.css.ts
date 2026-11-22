import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { glassDenseOverBackdrop } from '../ui/styles/Glass.css';
import { touchTarget } from '../ui/styles/touchTarget';

// A solid border line of the given width and color.
const solid = (width: string, lineColor: string) => `${width} solid ${lineColor}`;

const subtleBorder = `color-mix(in srgb, ${color.Surface.OnContainer} 10%, transparent)`;
const strongBorder = `color-mix(in srgb, ${color.Surface.OnContainer} 18%, transparent)`;
const activePillBorder = `color-mix(in srgb, ${color.Primary.OnContainer} 35%, transparent)`;
const subtleSurface = `color-mix(in srgb, ${color.Surface.OnContainer} 4%, transparent)`;
const hoverSurface = `color-mix(in srgb, ${color.Surface.OnContainer} 6%, transparent)`;

// The room header's schedules button; the count sits on its corner. 40 px with 4 px to the next
// button, so 44 by 44 px to a finger.
export const Trigger = style([{ position: 'relative' }, touchTarget('2px')]);

export const Count = style({
  position: 'absolute',
  insetBlockStart: toRem(2),
  insetInlineEnd: toRem(2),
  minWidth: toRem(14),
  height: toRem(14),
  paddingBlock: 0,
  paddingInline: toRem(3),
  borderRadius: config.radii.Pill,
  backgroundColor: color.Secondary.Main,
  color: color.Secondary.OnMain,
  fontSize: toRem(9),
  fontWeight: config.fontWeight.W600,
  lineHeight: toRem(14),
  textAlign: 'center',
  pointerEvents: 'none',
});

/** The horizontal center of the room view, in viewport pixels; RoomSchedulesOverlay sets it. */
export const ROOM_VIEW_CENTER = '--mr-room-view-center';

// Dense text: the glass is tinted nearly opaque so the room behind does not show through.
export const Dialog = style([
  glassDenseOverBackdrop,
  {
    width: `min(${toRem(540)}, 100vw)`,
    maxWidth: '100vw',
    maxHeight: `min(${toRem(700)}, 85vh, 100dvh)`,
    overflow: 'hidden',
    // Over the room view rather than the whole window, but never past the window's edges.
    translate: `clamp((100% - 100vw) / 2, var(${ROOM_VIEW_CENTER}, 50vw) - 50vw, (100vw - 100%) / 2) 0`,
  },
]);

export const Header = style({
  gap: config.space.S200,
  paddingInline: config.space.S400,
  borderBlockEnd: solid(config.borderWidth.B300, color.Surface.ContainerLine),
});

export const HeaderCount = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: toRem(22),
  height: toRem(20),
  paddingInline: toRem(7),
  borderRadius: config.radii.Pill,
  backgroundColor: `color-mix(in srgb, ${color.Surface.OnContainer} 8%, transparent)`,
  color: color.Surface.OnContainer,
  fontSize: config.fontSize.T200,
  fontWeight: config.fontWeight.W600,
  lineHeight: 1,
  flexShrink: 0,
});

export const Content = style({
  paddingBlock: config.space.S300,
  paddingInline: config.space.S400,
  minWidth: 0,
  '@media': {
    '(max-width: 380px)': {
      paddingInline: config.space.S300,
    },
  },
});

export const Empty = style({
  paddingBlock: config.space.S500,
  paddingInline: config.space.S300,
  alignItems: 'center',
  textAlign: 'center',
});

export const FilterBar = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  rowGap: `max(${toRem(14)}, 14px)`,
  columnGap: `max(${config.space.S200}, 8px)`,
  minWidth: 0,
});

export const FilterPill = style([
  {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: `max(${toRem(36)}, 36px)`,
    minHeight: `max(${toRem(32)}, 32px)`,
    gap: toRem(6),
    paddingBlock: toRem(5),
    paddingInline: toRem(10),
    borderRadius: config.radii.Pill,
    border: solid(config.borderWidth.B300, subtleBorder),
    backgroundColor: 'transparent',
    color: color.Surface.OnContainer,
    fontSize: config.fontSize.T200,
    fontWeight: config.fontWeight.W500,
    lineHeight: 1.2,
    cursor: 'pointer',
    selectors: {
      '&:hover': {
        backgroundColor: hoverSurface,
      },
      '&:focus-visible': {
        outline: `2px solid ${color.Surface.OnContainer}`,
        outlineOffset: '1px',
      },
    },
  },
  // 30 px padding box (32 px with 1 px borders) + 2 * 7 px = 44 px tall; 7 + 7 <= 14 px rowGap (zero overlap).
  touchTarget('4px', '', { blockReach: '7px' }),
]);

export const FilterPillActive = style({
  backgroundColor: color.Primary.Container,
  color: color.Primary.OnContainer,
  borderColor: activePillBorder,
  selectors: {
    '&:hover': {
      backgroundColor: color.Primary.ContainerHover,
    },
    '&:focus-visible': {
      outlineColor: color.Primary.OnContainer,
    },
  },
});

export const FilterCount = style({
  fontVariantNumeric: 'tabular-nums',
});

export const GroupHeading = style({
  marginBlockStart: config.space.S100,
  marginBlockEnd: 0,
  textTransform: 'none',
});

export const Item = style({
  minWidth: 0,
  border: solid(config.borderWidth.B300, subtleBorder),
  borderRadius: config.radii.R400,
  overflow: 'hidden',
  transition: 'border-color 140ms ease',
  selectors: {
    '&[data-expanded="true"]': {
      borderColor: strongBorder,
    },
  },
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },
});

export const RowHeading = style({
  margin: 0,
  font: 'inherit',
  minWidth: 0,
});

export const RowHeader = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: config.space.S300,
  width: '100%',
  minWidth: 0,
  paddingBlock: config.space.S300,
  paddingInline: config.space.S300,
  border: 'none',
  backgroundColor: 'transparent',
  color: color.Surface.OnContainer,
  textAlign: 'start',
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      backgroundColor: hoverSurface,
    },
    '&:focus-visible': {
      outline: `2px solid ${color.Surface.OnContainer}`,
      outlineOffset: '-2px',
    },
  },
});

export const IconTile = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: toRem(28),
  height: toRem(28),
  borderRadius: config.radii.R300,
  flexShrink: 0,
  marginBlockStart: toRem(1),
});

export const IconTilePrimary = style({
  backgroundColor: color.Primary.Container,
  color: color.Primary.OnContainer,
});

export const IconTileSuccess = style({
  backgroundColor: color.Success.Container,
  color: color.Success.OnContainer,
});

export const IconTileWarning = style({
  backgroundColor: color.Warning.Container,
  color: color.Warning.OnContainer,
});

export const RowBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: toRem(4),
  flex: '1 1 auto',
  minWidth: 0,
});

export const RowTopLine = style({
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: config.space.S200,
  flexWrap: 'wrap',
  minWidth: 0,
});

export const RowTitle = style({
  flex: `1 1 min(100%, ${toRem(140)})`,
  minWidth: 0,
  margin: 0,
});

export const StatusPill = style({
  display: 'inline-flex',
  alignItems: 'center',
  paddingBlock: toRem(2),
  paddingInline: toRem(8),
  borderRadius: config.radii.Pill,
  border: solid(config.borderWidth.B300, 'transparent'),
  fontSize: config.fontSize.T200,
  fontWeight: config.fontWeight.W500,
  lineHeight: 1.3,
  flexShrink: 0,
  maxWidth: '100%',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  fontVariantNumeric: 'tabular-nums',
});

export const StatusPillPrimary = style({
  backgroundColor: color.Primary.Container,
  color: color.Primary.OnContainer,
  borderColor: color.Primary.ContainerLine,
});

export const StatusPillSuccess = style({
  backgroundColor: color.Success.Container,
  color: color.Success.OnContainer,
  borderColor: color.Success.ContainerLine,
});

export const StatusPillWarning = style({
  backgroundColor: color.Warning.Container,
  color: color.Warning.OnContainer,
  borderColor: color.Warning.ContainerLine,
});

// 90% mix preserves >= 5.06:1 contrast even on row hover across all 23 palettes.
export const RowSubtitle = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  columnGap: toRem(6),
  rowGap: toRem(2),
  minWidth: 0,
  color: `color-mix(in srgb, ${color.Surface.OnContainer} 90%, transparent)`,
});

export const SubtitleDot = style({
  userSelect: 'none',
});

export const Chevron = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  marginBlockStart: toRem(4),
  opacity: 0.75,
  transition: 'transform 160ms ease',
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },
});

export const ChevronOpen = style({
  transform: 'rotate(180deg)',
});

export const Drawer = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S300,
  paddingBlock: config.space.S300,
  paddingInline: config.space.S300,
  borderBlockStart: solid(config.borderWidth.B300, subtleBorder),
  minWidth: 0,
});

export const ChipRow = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
});

export const Chip = style({
  display: 'inline-flex',
  alignItems: 'center',
  maxWidth: '100%',
  minWidth: 0,
  paddingBlock: toRem(2),
  paddingInline: toRem(8),
  borderRadius: config.radii.Pill,
  backgroundColor: color.Secondary.Container,
  color: color.Secondary.OnContainer,
  fontSize: config.fontSize.L400,
  fontWeight: config.fontWeight.W500,
  lineHeight: 1.35,
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
});

export const PromptWell = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  borderRadius: config.radii.R300,
  backgroundColor: subtleSurface,
  border: solid(config.borderWidth.B300, subtleBorder),
  minWidth: 0,
});

// Long words, URLs and display names wrap instead of widening the card on phones.
export const Wrap = style({
  minWidth: 0,
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
});

export const Prompt = style([
  Wrap,
  {
    whiteSpace: 'pre-wrap',
    margin: 0,
    lineHeight: 1.5,
  },
]);

export const PromptClamped = style({
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});

export const InlineCode = style({
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: '0.9em',
  paddingBlock: toRem(1),
  paddingInline: toRem(4),
  borderRadius: config.radii.R300,
  backgroundColor: `color-mix(in srgb, ${color.Surface.OnContainer} 8%, transparent)`,
  color: color.Surface.OnContainer,
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
});

export const PromptMention = style({
  color: color.Primary.OnContainer,
  backgroundColor: color.Primary.Container,
  borderRadius: config.radii.R300,
  paddingInline: toRem(3),
  fontWeight: config.fontWeight.W500,
});

export const PromptToggle = style([
  {
    alignSelf: 'flex-start',
    paddingBlock: toRem(2),
    paddingInline: 0,
    border: 'none',
    backgroundColor: 'transparent',
    color: color.Surface.OnContainer,
    fontWeight: config.fontWeight.W600,
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
    cursor: 'pointer',
    selectors: {
      '&:hover': {
        textDecorationThickness: '2px',
      },
      '&:focus-visible': {
        outline: `2px solid ${color.Surface.OnContainer}`,
        outlineOffset: '2px',
        borderRadius: config.radii.R300,
      },
    },
    '@media': {
      '(pointer: coarse)': {
        minWidth: `max(${toRem(44)}, 44px)`,
        textAlign: 'start',
      },
    },
  },
  touchTarget('4px', '', { blockReach: '12px' }),
]);

export const CancelBar = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  borderRadius: config.radii.R300,
  backgroundColor: color.Critical.Container,
  color: color.Critical.OnContainer,
  border: solid(config.borderWidth.B300, color.Critical.ContainerLine),
  minWidth: 0,
});

export const CancelBarActions = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  rowGap: `max(${toRem(14)}, 14px)`,
  columnGap: `max(${config.space.S300}, 12px)`,
});

export const CancelError = style({
  color: color.Critical.OnContainer,
  fontWeight: config.fontWeight.W600,
});

export const CancelSentBar = style({
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  borderRadius: config.radii.R300,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  minWidth: 0,
});

export const NoticeBar = style({
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  borderRadius: config.radii.R300,
  backgroundColor: color.Warning.Container,
  color: color.Warning.OnContainer,
  border: solid(config.borderWidth.B300, color.Warning.ContainerLine),
  minWidth: 0,
});

export const ActionsRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  rowGap: `max(${toRem(14)}, 14px)`,
  columnGap: `max(${config.space.S200}, 8px)`,
  minWidth: 0,
});

export const ActionsPrimary = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  rowGap: `max(${toRem(14)}, 14px)`,
  columnGap: `max(${config.space.S200}, 8px)`,
  minWidth: 0,
});

export const ActionsSecondary = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  rowGap: `max(${toRem(14)}, 14px)`,
  columnGap: `max(${config.space.S300}, 12px)`,
  marginInlineStart: 'auto',
  minWidth: 0,
});

export const CompactAction = style([
  {
    minWidth: `max(${toRem(36)}, 36px)`,
    minHeight: `max(${toRem(32)}, 32px)`,
    selectors: {
      '&:focus-visible': {
        outline: `2px solid ${color.Surface.OnContainer}`,
        outlineOffset: toRem(2),
      },
    },
  },
  // 30-32 px padding box + 2 * 7 px = 44-46 px tall; 7 + 7 <= 14 px rowGap (zero overlap at any zoom).
  touchTarget('4px', '', { blockReach: '7px' }),
]);

export const IconAction = style([
  {
    minWidth: `max(${toRem(32)}, 32px)`,
    minHeight: `max(${toRem(32)}, 32px)`,
    selectors: {
      '&:focus-visible': {
        outline: `2px solid ${color.Surface.OnContainer}`,
        outlineOffset: toRem(2),
      },
      '&[aria-disabled="true"]': {
        opacity: '1 !important',
        cursor: 'progress',
      },
    },
  },
  touchTarget('6px', '', { blockReach: '6px' }),
]);

export const IconMuted = style({
  opacity: 0.5,
});

export const CopiedStatus = style({
  display: 'inline-flex',
  alignItems: 'center',
  paddingBlock: toRem(2),
  paddingInline: toRem(8),
  borderRadius: config.radii.Pill,
  backgroundColor: color.Success.Container,
  color: color.Success.OnContainer,
  border: solid(config.borderWidth.B300, color.Success.ContainerLine),
  fontSize: config.fontSize.L400,
  fontWeight: config.fontWeight.W600,
  lineHeight: 1.35,
});

export const CancelBarButton = style([
  {
    minWidth: `max(${toRem(36)}, 36px)`,
    minHeight: `max(${toRem(32)}, 32px)`,
    selectors: {
      '&:focus-visible': {
        outline: `2px solid ${color.Critical.OnContainer}`,
        outlineOffset: toRem(2),
      },
      '&[aria-disabled="true"]': {
        opacity: '1 !important',
        cursor: 'progress',
      },
    },
  },
  // 30-32 px padding box + 2 * 7 px = 44-46 px tall; 7 + 7 <= 14 px rowGap and 4 + 4 <= 12 px columnGap.
  touchTarget('4px', '', { blockReach: '7px' }),
]);

export const Metadata = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, max-content) minmax(0, 1fr)',
  columnGap: config.space.S300,
  rowGap: config.space.S100,
  margin: 0,
  paddingBlockStart: config.space.S300,
  borderBlockStart: solid(config.borderWidth.B300, subtleBorder),
  minWidth: 0,
  '@media': {
    '(max-width: 360px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
});

globalStyle(`${Metadata} dd`, { margin: 0, minWidth: 0 });

export const MetaLabel = style({
  color: `color-mix(in srgb, ${color.Surface.OnContainer} 88%, transparent)`,
  fontWeight: config.fontWeight.W500,
});

export const TaskId = style([
  Wrap,
  {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    userSelect: 'text',
  },
]);

export const TaskIdInput = style({
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  paddingBlock: toRem(4),
  paddingInline: toRem(8),
  borderRadius: config.radii.R300,
  border: solid(config.borderWidth.B300, subtleBorder),
  backgroundColor: subtleSurface,
  color: color.Surface.OnContainer,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: 'inherit',
  lineHeight: 1.4,
  resize: 'none',
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${color.Surface.OnContainer}`,
      outlineOffset: toRem(2),
    },
  },
});

export const Awaiting = style({
  color: color.Warning.OnContainer,
  fontWeight: config.fontWeight.W600,
});

export const SrOnly = style({
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
});
