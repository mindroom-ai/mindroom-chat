import { globalStyle, style, styleVariants } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { touchTarget } from '../ui/styles/touchTarget';

const solid = (width: string, lineColor: string) => `${width} solid ${lineColor}`;
const surfaceMix = (pct: number) =>
  `color-mix(in srgb, ${color.Surface.OnContainer} ${pct}%, transparent)`;
const subtleBorder = surfaceMix(10);
const activePillBorder = `color-mix(in srgb, ${color.Primary.OnContainer} 35%, transparent)`;
const monoFont = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
const tones = {
  primary: color.Primary,
  success: color.Success,
  warning: color.Warning,
  neutral: color.SurfaceVariant,
} as const;
const toneSurface = (tone: { Container: string; OnContainer: string; ContainerLine: string }) => ({
  backgroundColor: tone.Container,
  color: tone.OnContainer,
  border: solid(config.borderWidth.B300, tone.ContainerLine),
});
const reducedMotionNone = {
  '@media': { '(prefers-reduced-motion: reduce)': { transition: 'none' } },
} as const;
const focusRing = (ringColor: string, outlineOffset: string = toRem(2)) => ({
  outline: `2px solid ${ringColor}`,
  outlineOffset,
});
const minBox = (w: number, h: number) => ({
  minWidth: `max(${toRem(w)}, ${w}px)`,
  minHeight: `max(${toRem(h)}, ${h}px)`,
});
const disabledProgress = { opacity: '1 !important', cursor: 'progress' } as const;
const inlineCenter = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
} as const;
const flexCol = (gap: string) =>
  ({ display: 'flex', flexDirection: 'column', gap, minWidth: 0 }) as const;
const flexWrap = { display: 'flex', flexWrap: 'wrap', minWidth: 0 } as const;
const pillBase = {
  display: 'inline-flex',
  alignItems: 'center',
  paddingBlock: toRem(2),
  paddingInline: toRem(8),
  borderRadius: config.radii.Pill,
} as const;
const actionRowBase = {
  ...flexWrap,
  alignItems: 'center',
  rowGap: `max(${toRem(14)}, 14px)`,
  columnGap: `max(${config.space.S200}, 8px)`,
} as const;
const panelBoxBase = {
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  borderRadius: config.radii.R300,
  minWidth: 0,
} as const;
const compactTouchBase = minBox(38, 33);
// 36-38 px padding box + 2 * 4 px = 44-46 px wide; 30-33 px + 2 * 7 px = 44-47 px tall (zero overlap).
const compactTouch = touchTarget('4px', '', { blockReach: '7px' });

export const FilterBar = style(actionRowBase);

export const FilterPill = style([
  compactTouchBase,
  {
    ...inlineCenter,
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
      '&:hover': { backgroundColor: surfaceMix(6) },
      '&:focus-visible': focusRing(color.Surface.OnContainer, '1px'),
    },
  },
  compactTouch,
]);

export const FilterPillActive = style({
  backgroundColor: color.Primary.Container,
  color: color.Primary.OnContainer,
  borderColor: activePillBorder,
  selectors: {
    '&:hover': { backgroundColor: color.Primary.ContainerHover },
    '&:focus-visible': { outlineColor: color.Primary.OnContainer },
  },
});

export const FilterCount = style({ fontVariantNumeric: 'tabular-nums' });

export const GroupHeading = style({
  marginBlockStart: config.space.S100,
  marginBlockEnd: 0,
  textTransform: 'none',
});

export const Item = style([
  {
    minWidth: 0,
    border: solid(config.borderWidth.B300, subtleBorder),
    borderRadius: config.radii.R400,
    overflow: 'hidden',
    transition: 'border-color 140ms ease',
    selectors: { '&[data-expanded="true"]': { borderColor: surfaceMix(18) } },
  },
  reducedMotionNone,
]);

export const RowHeading = style({ margin: 0, font: 'inherit', minWidth: 0 });

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
    '&:hover': { backgroundColor: surfaceMix(6) },
    '&:focus-visible': focusRing(color.Surface.OnContainer, '-2px'),
  },
  '@media': { '(pointer: coarse)': { minBlockSize: `max(${toRem(44)}, 44px)` } },
});

const iconTileBase = style({
  ...inlineCenter,
  width: toRem(28),
  height: toRem(28),
  borderRadius: config.radii.R300,
  flexShrink: 0,
  marginBlockStart: toRem(1),
});

export const IconTile = styleVariants(tones, (tone) => [
  iconTileBase,
  { backgroundColor: tone.Container, color: tone.OnContainer },
]);

export const RowBody = style({ ...flexCol(toRem(4)), flex: '1 1 auto' });
export const RowTopLine = style({
  ...flexWrap,
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: config.space.S200,
});
export const RowTitle = style({ flex: `1 1 min(100%, ${toRem(140)})`, minWidth: 0, margin: 0 });

// Long words, URLs and display names wrap instead of widening the card on phones.
export const Wrap = style({ minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word' });

const statusPillBase = style([
  Wrap,
  {
    ...pillBase,
    fontSize: config.fontSize.T200,
    fontWeight: config.fontWeight.W500,
    lineHeight: 1.3,
    flexShrink: 0,
    maxWidth: '100%',
    fontVariantNumeric: 'tabular-nums',
  },
]);

export const StatusPill = styleVariants(tones, (tone) => [statusPillBase, toneSurface(tone)]);

// 90% mix preserves >= 5.06:1 contrast even on row hover across all 23 palettes.
export const RowSubtitle = style({
  ...flexWrap,
  alignItems: 'baseline',
  columnGap: toRem(6),
  rowGap: toRem(2),
  color: surfaceMix(90),
});
export const SubtitleDot = style({ userSelect: 'none' });

export const Chevron = style([
  {
    ...inlineCenter,
    flexShrink: 0,
    marginBlockStart: toRem(4),
    opacity: 0.75,
    transition: 'transform 160ms ease',
  },
  reducedMotionNone,
]);
export const ChevronOpen = style({ transform: 'rotate(180deg)' });

export const Drawer = style({
  ...flexCol(config.space.S300),
  paddingBlock: config.space.S300,
  paddingInline: config.space.S300,
  borderBlockStart: solid(config.borderWidth.B300, subtleBorder),
});

export const ChipRow = style({ ...flexWrap, alignItems: 'center', gap: config.space.S100 });
export const Chip = style([
  Wrap,
  {
    ...pillBase,
    maxWidth: '100%',
    backgroundColor: color.Secondary.Container,
    color: color.Secondary.OnContainer,
    fontSize: config.fontSize.L400,
    fontWeight: config.fontWeight.W500,
    lineHeight: 1.35,
  },
]);

export const PromptWell = style({
  ...panelBoxBase,
  ...flexCol(config.space.S200),
  backgroundColor: surfaceMix(4),
  border: solid(config.borderWidth.B300, subtleBorder),
});
export const Prompt = style([Wrap, { whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.5 }]);
export const PromptClamped = style({
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
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
      '&:hover': { textDecorationThickness: '2px' },
      '&:focus-visible': {
        ...focusRing(color.Surface.OnContainer),
        borderRadius: config.radii.R300,
      },
    },
    '@media': {
      '(pointer: coarse)': {
        minInlineSize: `max(${toRem(44)}, 44px)`,
        minBlockSize: `max(${toRem(44)}, 44px)`,
        textAlign: 'start',
      },
    },
  },
  touchTarget('4px', ''),
]);

export const CancelBar = style({
  ...panelBoxBase,
  ...flexCol(config.space.S200),
  ...toneSurface(color.Critical),
});
const wideColGap = { columnGap: `max(${config.space.S300}, 12px)` } as const;
export const CancelBarActions = style([actionRowBase, wideColGap]);
export const CancelError = style({
  color: color.Critical.OnContainer,
  fontWeight: config.fontWeight.W600,
});
export const CancelSentBar = style({
  ...panelBoxBase,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
});
export const NoticeBar = style({ ...panelBoxBase, ...toneSurface(color.Warning) });

export const ActionsRow = style([actionRowBase, { justifyContent: 'space-between' }]);
export const ActionsPrimary = style(actionRowBase);
export const ActionsSecondary = style([actionRowBase, wideColGap, { marginInlineStart: 'auto' }]);

const compactBtn = (ringColor: string, extra?: Record<string, Record<string, string>>) =>
  style([
    compactTouchBase,
    { selectors: { '&:focus-visible': focusRing(ringColor), ...extra } },
    compactTouch,
  ]);
export const CompactAction = compactBtn(color.Surface.OnContainer);
export const CancelBarButton = compactBtn(color.Critical.OnContainer, {
  '&[aria-disabled="true"]': disabledProgress,
});
export const IconAction = style([
  minBox(32, 32),
  {
    selectors: {
      '&:focus-visible': focusRing(color.Surface.OnContainer),
      '&[aria-disabled="true"]': disabledProgress,
    },
  },
  touchTarget('6px', '', { blockReach: '6px' }),
]);
export const IconMuted = style({ opacity: 0.5 });
export const CopiedStatus = style({
  ...pillBase,
  ...toneSurface(color.Success),
  fontSize: config.fontSize.L400,
  fontWeight: config.fontWeight.W600,
  lineHeight: 1.35,
});

export const Metadata = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, max-content) minmax(0, 1fr)',
  columnGap: config.space.S300,
  rowGap: config.space.S100,
  margin: 0,
  paddingBlockStart: config.space.S300,
  borderBlockStart: solid(config.borderWidth.B300, subtleBorder),
  minWidth: 0,
  '@media': { '(max-width: 360px)': { gridTemplateColumns: 'minmax(0, 1fr)' } },
});
globalStyle(`${Metadata} dd`, { margin: 0, minWidth: 0 });

export const MetaLabel = style({ color: surfaceMix(88), fontWeight: config.fontWeight.W500 });
export const TaskId = style([Wrap, { fontFamily: monoFont, userSelect: 'text' }]);
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
