import { type StyleRule, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { touchTarget } from '../ui/styles/touchTarget';

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
const muted: StyleRule = { opacity: config.opacity.P300 };

const hairline = (tone: string) => `${config.borderWidth.B300} solid ${tone}`;

const column: StyleRule = { display: 'flex', flexDirection: 'column' };

const centeredRow = (gap: string): StyleRule => ({
  display: 'flex',
  alignItems: 'center',
  gap,
});

const ellipsis: StyleRule = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

// Text fields and selects of the picker.
const field = {
  color: color.SurfaceVariant.OnContainer,
  border: hairline(color.SurfaceVariant.ContainerLine),
  backgroundColor: color.SurfaceVariant.Container,
} as const;

// A hover fill and a focus ring in the colors of the control's tone.
const hoverAndFocus = (fill: string, ring: string) =>
  ({
    '&:hover': { backgroundColor: fill },
    '&:focus-visible': { outline: `2px solid ${ring}` },
  } as const);

// The menu above the model button, the message menu's glass and rows. Its rows scroll inside it.
export const Panel = style([
  column,
  {
    width: toRem(272),
    maxWidth: `calc(100vw - ${toRem(32)})`,
  },
]);

// The filter field, runtime chooser and status above the rows, which stay while the rows scroll.
export const Controls = style([
  column,
  {
    flex: 'none',
    gap: config.space.S100,
    paddingBlockStart: config.space.S100,
    paddingInline: config.space.S100,
  },
]);

export const SearchRow = style([
  centeredRow(config.space.S200),
  field,
  {
    height: toRem(32),
    paddingInline: config.space.S200,
    borderRadius: config.radii.R300,
    selectors: {
      '&:focus-within': { borderColor: color.Primary.Main },
    },
  },
]);

export const SearchIcon = style([muted, { flexShrink: 0 }]);

export const SearchInput = style({
  ...blend,
  flex: '1 1 auto',
  minWidth: 0,
  border: 'none',
  outline: 'none',
  fontSize: config.fontSize.T300,
  padding: 0,
  selectors: { '&::placeholder': { color: 'inherit', opacity: config.opacity.Placeholder } },
});

export const RuntimeRow = style([
  centeredRow(config.space.S200),
  {
    paddingInline: config.space.S200,
    fontSize: config.fontSize.T200,
  },
]);

export const RuntimeLabel = style([muted, { flexShrink: 0 }]);

export const RuntimeSelect = style([
  field,
  {
    flex: '1 1 auto',
    minWidth: 0,
    font: 'inherit',
    paddingBlock: config.space.S100,
    paddingInline: config.space.S200,
    borderRadius: config.radii.R300,
  },
]);

export const StatusRow = style([
  centeredRow(config.space.S200),
  muted,
  {
    paddingBlock: config.space.S100,
    paddingInline: config.space.S200,
    fontSize: config.fontSize.T200,
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
    borderRadius: config.radii.R300,
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

// The highlight shows the row the keys are on; the list itself draws no focus ring.
export const Results = style([
  column,
  {
    gap: config.space.S100,
    padding: config.space.S100,
    outline: 'none',
  },
]);

export const Group = style([column, { gap: config.space.S100 }]);

export const GroupTitle = style([
  muted,
  {
    paddingBlockStart: config.space.S200,
    paddingInline: config.space.S300,
    fontSize: config.fontSize.O400,
    lineHeight: toRem(16),
    fontWeight: config.fontWeight.W500,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
]);

// Two lines, 48 px tall, so a row is a finger's height on a phone too.
export const Option = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  paddingBlock: toRem(6),
  paddingInlineStart: config.space.S300,
  paddingInlineEnd: config.space.S200,
  borderRadius: config.radii.R300,
  cursor: 'pointer',
  selectors: {
    '&[data-active="true"]': { backgroundColor: color.Surface.ContainerHover },
    '&[aria-disabled="true"]': { cursor: 'default', opacity: config.opacity.Disabled },
  },
});

export const OptionIcon = style({
  flexShrink: 0,
  display: 'inline-grid',
  placeItems: 'center',
  width: toRem(20),
  height: toRem(20),
  overflow: 'hidden',
});

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
    fontSize: config.fontSize.T300,
    lineHeight: toRem(20),
    selectors: {
      [`[aria-selected="true"] > ${OptionText} > &`]: { fontWeight: config.fontWeight.W500 },
    },
  },
]);

export const OptionDetail = style([
  ellipsis,
  muted,
  {
    fontSize: config.fontSize.T200,
    lineHeight: toRem(16),
  },
]);

// "Room default" names each agent's model; its line wraps rather than cutting names off.
export const RoomDefaultDetail = style([
  OptionDetail,
  { whiteSpace: 'normal', overflowWrap: 'anywhere' },
]);

export const Check = style({
  flexShrink: 0,
  color: color.Primary.Main,
});

export const Empty = style([
  muted,
  {
    padding: config.space.S400,
    textAlign: 'center',
    fontSize: config.fontSize.T300,
  },
]);

const triggerSize = toRem(32);

// The button at the start of the composer: the provider's logo alone, without the glass of the
// buttons after it, the same 32 px square and 44 px to a finger.
export const Trigger = style([
  control,
  touchTarget('2px'),
  {
    position: 'relative',
    flexShrink: 0,
    display: 'inline-grid',
    placeItems: 'center',
    inlineSize: triggerSize,
    padding: 0,
    blockSize: triggerSize,
    borderRadius: config.radii.R300,
    color: color.SurfaceVariant.OnContainer,
    selectors: {
      ...hoverAndFocus(color.SurfaceVariant.ContainerHover, color.Primary.Main),
      '&[aria-expanded="true"]': { backgroundColor: color.SurfaceVariant.ContainerActive },
    },
  },
]);

// The logo stays quiet until the button is pointed at, focused or open.
export const TriggerIcon = style({
  opacity: config.opacity.P300,
  selectors: {
    [`${Trigger}:hover &`]: { opacity: 1 },
    [`${Trigger}:focus-visible &`]: { opacity: 1 },
    [`${Trigger}[aria-expanded="true"] &`]: { opacity: 1 },
  },
});

// The hairline between the model button and the composer's other buttons.
export const TriggerDivider = style({
  flexShrink: 0,
  width: config.borderWidth.B300,
  height: toRem(20),
  backgroundColor: color.SurfaceVariant.ContainerLine,
});

// The model's name in the button, for screen readers and the text a test reads; the tooltip
// shows it.
export const VisuallyHidden = style({
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
});
