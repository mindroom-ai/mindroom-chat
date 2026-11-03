import { type StyleRule, globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const blend = {
  color: 'inherit',
  background: 'transparent',
  font: 'inherit',
} as const;

const control = {
  ...blend,
  margin: 0,
  border: 0,
  cursor: 'pointer',
} as const;

// Secondary text: dimmed rather than recolored, so it follows the surface it sits on.
const muted: StyleRule = { opacity: config.opacity.P400 };

const hairline = (tone: string) => `${config.borderWidth.B300} solid ${tone}`;

const column: StyleRule = { display: 'flex', flexDirection: 'column' };

const centeredRow = (gap: string, display: 'flex' | 'inline-flex' = 'flex'): StyleRule => ({
  display,
  alignItems: 'center',
  gap,
});

const ellipsis: StyleRule = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

// The font size and the line height of one folds type scale step.
const typeScale = (step: keyof typeof config.fontSize): StyleRule => ({
  fontSize: config.fontSize[step],
  lineHeight: config.lineHeight[step],
});

// A small square that centers its icon, for icon buttons and the icon of an option.
const tile: StyleRule = {
  flexShrink: 0,
  display: 'inline-grid',
  placeItems: 'center',
  width: toRem(28),
  height: toRem(28),
  borderRadius: config.radii.R300,
};

const outlined = {
  color: color.SurfaceVariant.OnContainer,
  border: hairline(color.SurfaceVariant.ContainerLine),
} as const;

// Text fields and selects of the picker.
const field = { ...outlined, backgroundColor: color.SurfaceVariant.Container } as const;

// A hover fill and a focus ring in the colors of the control's tone.
const hoverAndFocus = (fill: string, ring: string, focusExtras: StyleRule = {}) =>
  ({
    '&:hover': { backgroundColor: fill },
    '&:focus-visible': { outline: `2px solid ${ring}`, ...focusExtras },
  } as const);

// The desktop popover above the composer's model trigger.
export const Panel = style([
  column,
  {
    width: toRem(360),
    maxWidth: 'calc(100vw - 2rem)',
    height: `min(${toRem(480)}, 70vh)`,
    borderRadius: config.radii.R500,
    overflow: 'hidden',
    boxShadow: config.shadow.E300,
  },
]);

// On phones the panel fills the bottom sheet instead of floating.
export const MobilePanel = style({
  width: '100%',
  maxWidth: '100%',
  height: '100%',
  maxHeight: '100%',
  borderRadius: 0,
  boxShadow: 'none',
});

// The sheet's Modal holds the focus trap's wrapper; that wrapper passes the sheet's height on, so
// the panel inside stays as tall as the sheet and its results scroll beneath the controls.
globalStyle(`${MobilePanel}:not(${Panel}) > div`, { height: '100%', minHeight: 0 });

export const MobileContainer = style({
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  padding: `${config.space.S400} 0 0`,
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  pointerEvents: 'none',
});

globalStyle(`${MobileContainer} > *`, { pointerEvents: 'auto', maxHeight: '85vh', width: '100%' });

export const Controls = style([
  column,
  {
    alignItems: 'stretch',
    flex: 'none',
    rowGap: config.space.S200,
    padding: config.space.S300,
    borderBottom: hairline(color.Surface.ContainerLine),
    // The title, search and runtime rows set the height, not the folds Header size.
    selectors: { '&&': { height: 'auto' } },
  },
]);

export const Header = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: config.space.S200,
});

export const HeaderText = style([
  column,
  {
    flex: '1 1 auto',
    minWidth: 0,
    gap: config.space.S100,
  },
]);

export const Title = style({
  ...typeScale('H6'),
  fontWeight: config.fontWeight.W600,
});

export const Subtitle = style({
  ...typeScale('T200'),
  ...muted,
});

export const IconButton = style([
  control,
  tile,
  {
    selectors: hoverAndFocus(color.SurfaceVariant.ContainerHover, color.Primary.Main),
  },
]);

export const SearchRow = style([
  centeredRow(config.space.S200),
  field,
  {
    padding: `0 ${config.space.S200}`,
    borderRadius: config.radii.R400,
    selectors: {
      '&:focus-within': { borderColor: color.Primary.Main },
    },
  },
]);

export const SearchInput = style({
  ...blend,
  flex: '1 1 auto',
  minWidth: 0,
  border: 'none',
  outline: 'none',
  fontSize: config.fontSize.T300,
  padding: `${config.space.S100} 0`,
});

export const RuntimeRow = style([
  centeredRow(config.space.S200),
  {
    fontSize: config.fontSize.T200,
  },
]);

export const RuntimeLabel = style({
  flexShrink: 0,
  ...muted,
});

export const RuntimeSelect = style([
  field,
  {
    flex: '1 1 auto',
    minWidth: 0,
    font: 'inherit',
    padding: `${config.space.S100} ${config.space.S200}`,
    borderRadius: config.radii.R300,
  },
]);

export const StatusRow = style([
  centeredRow(config.space.S200),
  {
    fontSize: config.fontSize.T200,
    ...muted,
  },
]);

const danger = color.Critical;

export const Error = style([
  column,
  {
    gap: config.space.S100,
    paddingBlock: config.space.S200,
    paddingInline: config.space.S300,
    color: danger.OnContainer,
    backgroundColor: danger.Container,
    borderRadius: config.radii.R400,
    fontSize: config.fontSize.T200,
  },
]);

export const ErrorActions = style({
  display: 'flex',
  justifyContent: 'flex-end',
});

export const TextButton = style([
  control,
  {
    paddingBlock: config.space.S100,
    paddingInline: config.space.S200,
    borderRadius: config.radii.R300,
    fontWeight: config.fontWeight.W500,
    selectors: hoverAndFocus(color.Critical.ContainerHover, color.Critical.Main),
  },
]);

export const Results = style({
  padding: config.space.S200,
});

export const Group = style({
  display: 'flex',
  flexDirection: 'column',
  selectors: { '& + &': { marginTop: config.space.S200 } },
});

export const GroupTitle = style({
  padding: `${config.space.S200} ${config.space.S200} ${config.space.S100}`,
  fontSize: config.fontSize.O400,
  fontWeight: config.fontWeight.W500,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  ...muted,
});

export const Option = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S300,
  padding: `${config.space.S200} ${config.space.S200}`,
  borderRadius: config.radii.R400,
  cursor: 'pointer',
  selectors: {
    '&[data-active="true"]': { backgroundColor: color.SurfaceVariant.ContainerHover },
    '&[aria-selected="true"]': { color: color.Primary.Main },
    '&[aria-disabled="true"]': { cursor: 'default', opacity: config.opacity.Disabled },
  },
});

export const OptionIcon = style([tile, { overflow: 'hidden' }]);

export const IconImage = style({
  display: 'block',
  objectFit: 'contain',
  borderRadius: config.radii.R300,
});

export const OptionText = style([
  column,
  {
    flex: '1 1 auto',
    minWidth: 0,
  },
]);

export const OptionTitle = style([
  ellipsis,
  {
    ...typeScale('T300'),
    fontWeight: config.fontWeight.W500,
  },
]);

export const OptionDetail = style([
  ellipsis,
  {
    ...typeScale('T200'),
    ...muted,
  },
]);

export const Check = style({
  flexShrink: 0,
  color: color.Primary.Main,
});

export const Empty = style({
  padding: config.space.S400,
  textAlign: 'center',
  fontSize: config.fontSize.T300,
  ...muted,
});

// Under the results: which models the room inherits, or that the choice applies to new replies.
export const Footer = style({
  flex: 'none',
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  paddingBottom: `calc(${config.space.S200} + env(safe-area-inset-bottom, 0px))`,
  borderTop: hairline(color.Surface.ContainerLine),
});

export const FooterText = style({
  fontSize: config.fontSize.T200,
  ...muted,
});

// The composer's row above the editor that names the thread's model.
export const ComposerRow = style([
  centeredRow(config.space.S200),
  {
    minWidth: 0,
    padding: `${config.space.S100} ${config.space.S200} 0`,
  },
]);

export const ScopeLabel = style({
  flexShrink: 0,
  fontSize: config.fontSize.T200,
  ...muted,
});

export const Trigger = style([
  control,
  outlined,
  centeredRow(config.space.S100, 'inline-flex'),
  typeScale('T200'),
  {
    minWidth: 0,
    maxWidth: '100%',
    padding: `${toRem(2)} ${config.space.S200}`,
    borderRadius: config.radii.Pill,
    selectors: {
      ...hoverAndFocus(color.SurfaceVariant.ContainerHover, color.Primary.Main, {
        outlineOffset: 1,
      }),
      '&[aria-expanded="true"]': { backgroundColor: color.SurfaceVariant.ContainerActive },
    },
  },
]);

export const TriggerIcon = style({
  flexShrink: 0,
});

export const TriggerLabel = style([ellipsis, { minWidth: 0 }]);
