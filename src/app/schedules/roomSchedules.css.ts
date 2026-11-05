import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { glassDenseOverBackdrop } from '../ui/styles/Glass.css';

// A solid border line of the given width and color.
const solid = (width: string, lineColor: string) => `${width} solid ${lineColor}`;

// The room header's schedules button; the count sits on its corner.
export const Trigger = style({
  position: 'relative',
});

export const Count = style({
  position: 'absolute',
  top: toRem(2),
  insetInlineEnd: toRem(2),
  minWidth: toRem(14),
  height: toRem(14),
  padding: `0 ${toRem(3)}`,
  borderRadius: config.radii.Pill,
  backgroundColor: color.Secondary.Main,
  color: color.Secondary.OnMain,
  fontSize: toRem(9),
  fontWeight: config.fontWeight.W600,
  lineHeight: toRem(14),
  textAlign: 'center',
  pointerEvents: 'none',
});

/** The horizontal center of the room view, in viewport pixels; RoomSchedulesButton sets it. */
export const ROOM_VIEW_CENTER = '--mr-room-view-center';

// Dense text: the glass is tinted nearly opaque so the room behind does not show through.
export const Dialog = style([
  glassDenseOverBackdrop,
  {
    width: `min(${toRem(520)}, 100vw)`,
    maxWidth: '100vw',
    maxHeight: `min(${toRem(680)}, 85vh, 100dvh)`,
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

// The task cards, one under the other.
export const Content = style({
  padding: config.space.S400,
  minWidth: 0,
});

export const Empty = style({
  padding: `${config.space.S500} ${config.space.S300}`,
  alignItems: 'center',
  textAlign: 'center',
});

// An outline on the dialog's own material: the badges and text carry the card, not a fill. The
// line is a tint of the text color, so it stays darker than the glass in light themes too.
export const Card = style({
  minWidth: 0,
  border: solid(
    config.borderWidth.B300,
    `color-mix(in srgb, ${color.Surface.OnContainer} 8%, transparent)`
  ),
  borderRadius: config.radii.R400,
  padding: config.space.S400,
});

// Long words, URLs and display names wrap instead of widening the card on phones.
export const Wrap = style({
  minWidth: 0,
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
});

// Plain text under its label, like the other fields, with a reading line height for long prompts.
export const Prompt = style([
  Wrap,
  {
    whiteSpace: 'pre-wrap',
    margin: 0,
    lineHeight: 1.5,
  },
]);

export const Metadata = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, max-content) minmax(0, 1fr)',
  columnGap: config.space.S300,
  rowGap: config.space.S100,
  margin: 0,
  minWidth: 0,
  '@media': {
    '(max-width: 360px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
});

globalStyle(`${Metadata} dd`, { margin: 0, minWidth: 0 });

export const Awaiting = style({
  color: color.Warning.Main,
  fontWeight: config.fontWeight.W500,
});
