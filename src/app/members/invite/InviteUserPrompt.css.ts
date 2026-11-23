import { globalStyle, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { Viewport } from '../../ui/InsetScrollbar.css';
import { Segment, Segments } from '../../ui/styles/Segmented.css';
import { touchTarget } from '../../ui/styles/touchTarget';

const focusOutline = {
  outline: `${config.borderWidth.B400} solid ${color.Primary.Main}`,
  outlineOffset: config.borderWidth.B300,
};
const ghostHover = {
  backgroundColor: `color-mix(in srgb, ${color.SurfaceVariant.Container} 68%, transparent)`,
  color: color.Surface.OnContainer,
};

// Track visual viewport variables set by useMobileKeyboardViewportFix so mobile keyboards never cover the sheet.
export const ViewportCenter = style({
  selectors: {
    '&&': {
      height: 'var(--app-height, 100%)',
      marginBlockStart: 'var(--app-viewport-offset-top, 0px)',
    },
  },
});

export const Dialog = style({
  width: '100%',
  maxWidth: toRem(520),
  maxHeight: `min(${toRem(640)}, calc(var(--app-height, 100dvh) - ${toRem(48)}))`,
  display: 'flex',
  flexDirection: 'column',
});

export const TitleBar = style({
  flexShrink: 0,
  height: 'auto',
  minBlockSize: toRem(56),
  gap: config.space.S300,
  paddingBlockStart: config.space.S300,
  paddingBlockEnd: config.space.S100,
  paddingInline: config.space.S400,
});

export const TouchIcon = style([touchTarget('6px'), { flexShrink: 0 }]);

export const Controls = style({
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
  paddingBlock: config.space.S200,
  paddingInline: config.space.S400,
});

// Hide browser search cancel mark; the field renders its own Clear button.
export const SearchField = style({
  selectors: {
    '&&': {
      backgroundColor: `color-mix(in srgb, ${color.Background.Container} 72%, transparent)`,
      boxShadow: `inset 0 0 0 ${config.borderWidth.B300} color-mix(in srgb, ${color.Surface.ContainerLine} 80%, transparent)`,
      transition: 'box-shadow 120ms ease, background-color 120ms ease',
    },
    '&&:focus-within': {
      backgroundColor: color.Background.Container,
      boxShadow: `inset 0 0 0 ${config.borderWidth.B400} ${color.Primary.Main}`,
    },
  },
});
globalStyle(`${SearchField} input::-webkit-search-cancel-button`, { display: 'none' });
globalStyle(`${SearchField} > svg`, { flexShrink: 0, color: color.SurfaceVariant.OnContainer });

export const FilterSegments = style([
  Segments,
  { alignSelf: 'flex-start', maxInlineSize: '100%', flexWrap: 'wrap', rowGap: toRem(2) },
]);

export const FilterSegment = style([
  Segment,
  {
    paddingInline: config.space.S300,
    '@media': { '(pointer: coarse)': { minBlockSize: toRem(36) } },
  },
]);

export const Body = style([
  Viewport,
  { flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
]);

export const GrantAlert = style({
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  marginInline: config.space.S400,
  marginBlockEnd: config.space.S200,
  paddingBlock: config.space.S100,
  paddingInlineStart: config.space.S200,
  paddingInlineEnd: config.space.S100,
  borderRadius: config.radii.R300,
  backgroundColor: color.Critical.Container,
  color: color.Critical.OnContainer,
});

export const ListFrame = style({
  position: 'relative',
  flexGrow: 1,
  minBlockSize: toRem(140),
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});

export const ListArea = style([
  Viewport,
  {
    flexGrow: 1,
    minBlockSize: toRem(140),
    // Override Viewport's contain so scrolling past the list chains to Body on short keyboard viewports.
    overscrollBehaviorY: 'auto',
    paddingInline: config.space.S200,
    paddingBlockEnd: config.space.S200,
  },
]);

export const ListScrollbar = style({ insetBlock: toRem(4), zIndex: 2 });

export const SectionHeader = style({
  paddingBlockStart: config.space.S200,
  paddingBlockEnd: config.space.S100,
  paddingInline: config.space.S200,
  fontWeight: config.fontWeight.W600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
});

export const List = style([
  DefaultReset,
  { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: toRem(2) },
]);

export const Row = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S300,
  minBlockSize: toRem(50),
  paddingBlock: config.space.S100,
  paddingInline: config.space.S200,
  borderRadius: config.radii.R400,
  selectors: {
    '&:hover, &:focus-within': {
      backgroundColor: `color-mix(in srgb, ${color.Surface.ContainerHover} 75%, transparent)`,
    },
  },
});

export const RowName = style({ minInlineSize: 0, fontWeight: config.fontWeight.W500 });

export const AgentTag = style({
  flexShrink: 0,
  paddingBlock: toRem(1),
  paddingInline: toRem(6),
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  borderRadius: config.radii.R300,
  backgroundColor: `color-mix(in srgb, ${color.SurfaceVariant.Container} 55%, transparent)`,
  color: color.SurfaceVariant.OnContainer,
  fontSize: toRem(10),
  fontWeight: config.fontWeight.W600,
  lineHeight: toRem(14),
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
});

export const WrapText = style({ minInlineSize: 0, overflowWrap: 'anywhere' });

export const RowError = style({
  color: color.Critical.Main,
  overflowWrap: 'anywhere',
  marginBlockStart: toRem(2),
});

export const RowAction = style({
  flexShrink: 0,
  minInlineSize: toRem(80),
  transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease',
  '@media': { '(pointer: coarse)': { minBlockSize: toRem(38) } },
});

const idleActionBg = `color-mix(in srgb, ${color.Surface.Container} 40%, transparent)`;
export const RowActionIdle = style({
  selectors: {
    '&&': {
      backgroundColor: idleActionBg,
      border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
      color: color.Surface.OnContainer,
    },
    '&&[aria-disabled="true"]': { backgroundColor: idleActionBg },
    [`${Row}:hover &:not([aria-disabled="true"]), ${Row}:focus-within &:not([aria-disabled="true"])`]:
      {
        backgroundColor: color.Primary.Container,
        borderColor: color.Primary.ContainerLine,
        color: color.Primary.OnContainer,
      },
    '&&&:not([aria-disabled="true"]):hover, &&&:not([aria-disabled="true"]):focus-visible': {
      backgroundColor: color.Primary.Main,
      borderColor: color.Primary.Main,
      color: color.Primary.OnMain,
    },
  },
});

export const RowActionSent = style({
  vars: { [config.opacity.Disabled]: '1' },
  selectors: {
    '&&[aria-disabled="true"]': {
      cursor: 'default',
      border: `${config.borderWidth.B300} solid color-mix(in srgb, ${color.Success.ContainerLine} 70%, transparent)`,
      backgroundColor: color.Success.Container,
      color: color.Success.OnContainer,
    },
  },
});

export const CenteredHint = style({ padding: config.space.S200, textAlign: 'center' });
export const EmptyState = style({
  paddingBlock: config.space.S500,
  paddingInline: config.space.S400,
  textAlign: 'center',
});

export const Footer = style({
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
  paddingBlock: config.space.S300,
  paddingInline: config.space.S400,
  backgroundColor: `color-mix(in srgb, ${color.Background.Container} 42%, transparent)`,
  borderBlockStart: `${config.borderWidth.B300} solid color-mix(in srgb, ${color.Surface.ContainerLine} 60%, transparent)`,
});

export const ModeratorLabel = style({
  minInlineSize: 0,
  overflowWrap: 'break-word',
  cursor: 'pointer',
});

export const InfoButton = style([
  touchTarget('6px'),
  {
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    inlineSize: toRem(24),
    blockSize: toRem(24),
    padding: 0,
    border: 0,
    borderRadius: config.radii.Pill,
    background: 'none',
    color: color.SurfaceVariant.OnContainer,
    cursor: 'pointer',
    selectors: {
      '&:hover, &:focus-visible, &[aria-expanded="true"]': ghostHover,
      '&:focus-visible': focusOutline,
    },
  },
]);

export const ModeratorHelp = style({
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  borderRadius: config.radii.R300,
  color: color.Surface.OnContainer,
  backgroundColor: `color-mix(in srgb, ${color.SurfaceVariant.Container} 55%, transparent)`,
  border: `${config.borderWidth.B300} solid color-mix(in srgb, ${color.Surface.ContainerLine} 60%, transparent)`,
});

export const NoteToggle = style([
  touchTarget('6px'),
  {
    alignSelf: 'flex-start',
    paddingBlock: toRem(4),
    paddingInline: config.space.S100,
    marginInlineStart: `calc(-1 * ${config.space.S100})`,
    border: 0,
    background: 'none',
    color: color.SurfaceVariant.OnContainer,
    font: 'inherit',
    cursor: 'pointer',
    borderRadius: config.radii.R300,
    selectors: { '&:hover, &:focus-visible': ghostHover, '&:focus-visible': focusOutline },
  },
]);

export const VisuallyHidden = style({
  position: 'absolute',
  insetBlockStart: 0,
  insetInlineStart: 0,
  inlineSize: 1,
  blockSize: 1,
  margin: 0,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
});
