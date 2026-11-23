import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { SheetFooter, SheetRow, SheetRowAction } from '../../ui/DialogChrome.css';
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

export const Controls = style({
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
  paddingBlock: config.space.S200,
  paddingInline: config.space.S400,
});

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

export const ListFrame = style({ minBlockSize: toRem(140) });

export const ListArea = style({
  minBlockSize: toRem(140),
  paddingInline: config.space.S200,
  paddingBlockEnd: config.space.S200,
});

export const List = style([
  DefaultReset,
  { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: toRem(2) },
]);

export const Row = style([
  SheetRow,
  {
    display: 'flex',
    alignItems: 'center',
    gap: config.space.S300,
    minBlockSize: toRem(50),
    paddingBlock: config.space.S100,
    paddingInline: config.space.S200,
  },
]);

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

export const RowAction = style([SheetRowAction, { minInlineSize: toRem(80) }]);

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

export const Footer = style([
  SheetFooter,
  {
    display: 'flex',
    flexDirection: 'column',
    gap: config.space.S200,
  },
]);

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
