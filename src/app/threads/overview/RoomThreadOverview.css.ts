import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { motion } from '../../ui/styles/Motion.css';
import { transition } from '../../ui/styles/transition';
import { glassDenseOverBackdrop, glassFloating, glassSurface } from '../../ui/styles/Glass.css';

export const Overview = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  glassFloating,
  glassDenseOverBackdrop,
  {
    margin: `${config.space.S200} ${config.space.S300}`,
    position: 'relative', minWidth: 0,
    borderRadius: config.radii.R500,
    padding: config.space.S200,
    border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`, // room-light.png: a line outside the glass rim
  },
]);

export const ToolbarHeader = style({
  display: 'flex',
  // Wrap between groups when the room is narrow; groups themselves never
  // break apart (see ToggleGroup), so controls stay in recognizable rows.
  flexWrap: 'wrap',
  placeItems: 'center start',
  columnGap: config.space.S200, rowGap: config.space.S100,
});

export const ToggleGroup = style({
  display: 'flex',
  flexWrap: 'nowrap',
  columnGap: config.space.S100,
  placeItems: 'center',
  flexShrink: 0,
});

export const CompactCount = style({
  display: 'inline-flex',
  columnGap: toRem(3),
  placeItems: 'center',
  fontVariantNumeric: 'tabular-nums',
  paddingInline: toRem(2),
  color: color.SurfaceVariant.OnContainer,
  flexShrink: 0,
});

const TOGGLE_SIZE = toRem(32);

export const ToggleButton = style({
  position: 'relative',
  display: 'inline-grid',
  placeItems: 'center',
  width: TOGGLE_SIZE,
  height: TOGGLE_SIZE,
  minWidth: TOGGLE_SIZE,
  padding: 0,
  boxSizing: 'border-box',
  borderRadius: config.radii.R400,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`, // a light rim, as on every bar control
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  opacity: '0.72',
  cursor: 'pointer',
  font: 'inherit',
  transition: transition(['background-color', 'border-color', 'opacity'], motion.duration.Normal),

  // Only a pointer that can hover tints the button: a touch screen keeps :hover on the
  // button tapped last, so a toggle tapped off still looked on.
  '@media': {
    '(hover: hover)': {
      selectors: { '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover } },
    },
  },
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
});

export const ToggleInclude = style({
  backgroundColor: color.Success.Container,
  borderColor: color.Success.ContainerLine,
  color: color.Success.OnContainer,
  opacity: '1',

  '@media': {
    '(hover: hover)': {
      selectors: { '&:hover': { backgroundColor: color.Success.ContainerHover } },
    },
  },
});

export const ToggleIncludeOr = style({
  backgroundColor: color.Warning.Container, // either of the OR chips may match
  borderColor: color.Warning.ContainerLine,
  color: color.Warning.OnContainer,
  opacity: '1',

  '@media': {
    '(hover: hover)': {
      selectors: { '&:hover': { backgroundColor: color.Warning.ContainerHover } },
    },
  },
});

export const ToggleExclude = style({
  backgroundColor: color.Critical.Container, // threads with this status are hidden
  borderColor: color.Critical.ContainerLine,
  color: color.Critical.OnContainer,
  opacity: '1',

  '@media': {
    '(hover: hover)': {
      selectors: { '&:hover': { backgroundColor: color.Critical.ContainerHover } },
    },
  },
  selectors: {
    // A slash across the icon: the status is excluded.
    '&::after': {
      content: '""',
      position: 'absolute',
      insetBlockStart: '50%', insetInlineStart: '50%',
      width: '140%',
      height: toRem(2),
      backgroundColor: color.Critical.Main,
      transform: 'translate(-50%, -50%) rotate(-45deg)',
      pointerEvents: 'none',
    },
  },
});

export const SortButton = style({
  display: 'inline-flex',
  columnGap: config.space.S100,
  placeItems: 'center',
  flexShrink: 0,
  height: TOGGLE_SIZE,
  paddingInlineStart: config.space.S200,
  paddingInlineEnd: config.space.S200,
  boxSizing: 'border-box',
  borderRadius: config.radii.R400,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`, // matches the toggles
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  cursor: 'pointer', whiteSpace: 'nowrap',
  transition: transition(['background-color', 'border-color'], motion.duration.Normal),

  '@media': {
    '(hover: hover)': {
      selectors: { '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover } },
    },
  },
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
});

export const SortButtonActive = style({
  backgroundColor: color.Primary.Container,
  borderColor: color.Primary.ContainerLine,
  color: color.Primary.OnContainer,

  '@media': {
    '(hover: hover)': {
      selectors: { '&:hover': { backgroundColor: color.Primary.ContainerHover } },
    },
  },
});

export const PauseButtonActive = style({
  backgroundColor: color.Warning.Container, // the order holds still while locked
  borderColor: color.Warning.ContainerLine,
  color: color.Warning.OnContainer,
  opacity: '1',

  '@media': {
    '(hover: hover)': {
      selectors: { '&:hover': { backgroundColor: color.Warning.ContainerHover } },
    },
  },
});

// ─── Preset dropdown ────────────────────────────────────────────────────────

export const PresetContainer = style({
  position: 'relative',
  display: 'inline-flex',
  flexShrink: 0,
});

export const PresetButton = style({
  display: 'inline-flex',
  columnGap: config.space.S100,
  placeItems: 'center',
  height: TOGGLE_SIZE,
  paddingInlineStart: config.space.S200,
  paddingInlineEnd: config.space.S200,
  boxSizing: 'border-box',
  borderRadius: config.radii.R400,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`, // matches the toggles
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  cursor: 'pointer', whiteSpace: 'nowrap',
  font: 'inherit',
  transition: transition(['background-color', 'border-color'], motion.duration.Normal),
  '@media': {
    '(hover: hover)': {
      selectors: { '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover } },
    },
  },
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
});

export const PresetDropdown = style({
  position: 'absolute',
  top: `calc(${TOGGLE_SIZE} + ${config.space.S100})`,
  insetInlineStart: 0,
  zIndex: 200,
  minWidth: toRem(180),
  selectors: { '&&&': { backgroundColor: color.SurfaceVariant.Container } }, // the bar's blur ends at its edge
  padding: config.space.S100, // the options keep clear of the rounded edge
  borderRadius: config.radii.R400,
});

export const PresetOption = style({
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  paddingBlock: config.space.S100,
  paddingInline: config.space.S200,
  border: 'none',
  borderRadius: config.radii.R300,
  background: 'none',
  textAlign: 'start',
  font: 'inherit',
  color: 'inherit',
  cursor: 'pointer',
  selectors: {
    '&:hover, &[data-focused]': { backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '-2px',
    },
  },
});

// ─── Info popover ───────────────────────────────────────────────────────────

export const InfoContainer = style({
  position: 'relative',
  display: 'inline-flex',
  flexShrink: 0,
});

export const InfoButton = style({
  display: 'inline-grid',
  placeItems: 'center',
  boxSizing: 'border-box',
  width: TOGGLE_SIZE,
  height: TOGGLE_SIZE,
  minWidth: TOGGLE_SIZE,
  border: 'none',
  borderRadius: config.radii.R400,
  background: 'none',
  color: color.SurfaceVariant.OnContainer,
  cursor: 'pointer',
  padding: 0,
  font: 'inherit',
  transition: transition(['background-color'], motion.duration.Normal),
  '@media': {
    '(hover: hover)': {
      selectors: { '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover } },
    },
  },
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
});

export const InfoPopover = style({
  position: 'absolute',
  top: `calc(${TOGGLE_SIZE} + ${config.space.S100})`,
  insetInlineEnd: 0,
  zIndex: 200,
  minWidth: toRem(220),
  display: 'grid',
  selectors: { '&&&': { backgroundColor: color.SurfaceVariant.Container } }, // the bar's blur ends at its edge
  padding: config.space.S300,
  borderRadius: config.radii.R400,
});

export const InfoStatRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: `${toRem(2)} 0`,
});

export const InfoSectionDivider = style({
  height: config.borderWidth.B300,
  backgroundColor: color.SurfaceVariant.ContainerLine,
  margin: `${config.space.S200} 0`,
});

// ─── Search bar ─────────────────────────────────────────────────────────────

export const SearchContainer = style({
  display: 'inline-flex',
  placeItems: 'center',
  flexShrink: 0,
});

export const SearchInput = style({
  border: 'none',
  background: 'none',
  color: color.SurfaceVariant.OnContainer, // only the underline marks the field
  font: 'inherit',
  fontSize: toRem(13),
  outline: 'none',
  width: toRem(140),
  maxWidth: toRem(200),
  padding: `0 ${config.space.S200}`,
  height: TOGGLE_SIZE,
  borderBottom: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  selectors: {
    '&::placeholder': {
      color: color.SurfaceVariant.OnContainer,
      opacity: '0.5',
    },
    '&:focus': {
      borderBottomColor: color.Primary.Main,
    },
  },
});

// ─── Empty state ────────────────────────────────────────────────────────────

export const EmptyState = style({
  display: 'flex',
  flexWrap: 'wrap',
  columnGap: config.space.S200,
  placeItems: 'center',
  padding: `${config.space.S400} ${config.space.S200}`,
  color: color.SurfaceVariant.OnContainer,
});

export const ResetLink = style({
  color: color.Primary.Main,
  textDecoration: 'underline', textUnderlineOffset: toRem(2),
  cursor: 'pointer',
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
});
