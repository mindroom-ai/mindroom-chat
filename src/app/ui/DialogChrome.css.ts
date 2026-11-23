import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { Viewport } from './InsetScrollbar.css';
import { touchTarget } from './styles/touchTarget';

export const TouchIcon = style([touchTarget('6px'), { flexShrink: 0 }]);

// Close buttons sit at header ends; 12px reach keeps a 44x44px touch target even at 75% page zoom
// while clamping to 8px reach (44x44px) for a 28px pill at 100% zoom.
export const CloseTouchIcon = style([touchTarget('12px'), { flexShrink: 0 }]);

export const SheetTitleBar = style({
  flexShrink: 0,
  height: 'auto',
  minBlockSize: toRem(56),
  gap: config.space.S300,
  paddingBlockStart: config.space.S300,
  paddingBlockEnd: config.space.S100,
  paddingInline: config.space.S400,
});

// Hide browser search cancel mark; fields render their own clear control when needed.
export const InsetField = style({
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
  '@media': {
    '(pointer: coarse)': {
      selectors: { '&&': { minBlockSize: toRem(44), height: 'auto' } },
    },
    '(forced-colors: active)': {
      selectors: {
        '&&:focus-within': { outline: '2px solid Highlight' },
      },
    },
  },
});
globalStyle(`${InsetField} input::-webkit-search-cancel-button`, { display: 'none' });
globalStyle(`${InsetField} > svg`, { flexShrink: 0, color: color.SurfaceVariant.OnContainer });

export const SheetScrollFrame = style({
  position: 'relative',
  flexGrow: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});

export const SheetScrollViewport = style([
  Viewport,
  { flexGrow: 1, minHeight: 0, overscrollBehaviorX: 'contain' },
]);

// Override Viewport's contain so scrolling past a sheet list chains to an outer scroll container.
export const SheetScrollChain = style({
  selectors: { '&&': { overscrollBehaviorY: 'auto' } },
});

export const SheetScrollbar = style({ insetBlock: toRem(4), zIndex: 2 });

export const SheetSectionLabel = style({
  paddingBlockStart: config.space.S200,
  paddingBlockEnd: config.space.S100,
  paddingInline: config.space.S200,
  fontWeight: config.fontWeight.W600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
});

export const SheetRow = style({
  borderRadius: config.radii.R400,
  selectors: {
    '&:hover, &:focus-within': {
      backgroundColor: `color-mix(in srgb, ${color.Surface.ContainerHover} 75%, transparent)`,
    },
  },
});

export const SheetRowAction = style({
  flexShrink: 0,
  transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease',
  '@media': { '(pointer: coarse)': { minBlockSize: toRem(38) } },
});

// Pairs with SheetRow on the parent row so hovering/focusing a row promotes its action button.
const idleActionBg = `color-mix(in srgb, ${color.Surface.Container} 40%, transparent)`;
const enabledAction = ':not([aria-disabled="true"]):not(:disabled)';
export const SheetRowActionIdle = style({
  selectors: {
    '&&': {
      backgroundColor: idleActionBg,
      border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
      color: color.Surface.OnContainer,
    },
    '&&[aria-disabled="true"], &&:disabled': { backgroundColor: idleActionBg },
    [`${SheetRow}:hover &${enabledAction}, ${SheetRow}:focus-within &${enabledAction}`]: {
      backgroundColor: color.Primary.Container,
      borderColor: color.Primary.ContainerLine,
      color: color.Primary.OnContainer,
    },
    [`&&&${enabledAction}:hover, &&&${enabledAction}:focus-visible`]: {
      backgroundColor: color.Primary.Main,
      borderColor: color.Primary.Main,
      color: color.Primary.OnMain,
    },
  },
});

export const SheetFooter = style({
  flexShrink: 0,
  paddingBlock: config.space.S300,
  paddingInline: config.space.S400,
  backgroundColor: `color-mix(in srgb, ${color.Background.Container} 42%, transparent)`,
  borderBlockStart: `${config.borderWidth.B300} solid color-mix(in srgb, ${color.Surface.ContainerLine} 60%, transparent)`,
});
