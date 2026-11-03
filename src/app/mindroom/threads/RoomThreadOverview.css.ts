import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { motion } from '../../styles/Motion.css';
import { transition } from '../../styles/transition';
import { glassFloating, glassSurface } from '../../styles/Glass.css';

export const Overview = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  glassFloating,
  {
    margin: `${config.space.S200} ${config.space.S300}`,




  },
]);

export const ToolbarHeader = style({
  display: 'flex',
  // Wrap between groups when the room is narrow; groups themselves never
  // break apart (see ToggleGroup), so controls stay in recognizable rows.



});

export const ToggleGroup = style({
  display: 'flex',
  flexWrap: 'nowrap',



});

export const CompactCount = style({



  fontVariantNumeric: 'tabular-nums',



});

const TOGGLE_SIZE = toRem(32);

export const ToggleButton = style({



  width: TOGGLE_SIZE,
  height: TOGGLE_SIZE,
  minWidth: TOGGLE_SIZE,









  transition: transition(['background-color', 'border-color', 'opacity'], motion.duration.Normal),

  selectors: {
    '&:hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
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

  selectors: {
    '&:hover': {
      backgroundColor: color.Success.ContainerHover,
    },
  },
});

export const ToggleIncludeOr = style({



  opacity: '1',

  selectors: {
    '&:hover': {
      backgroundColor: color.Warning.ContainerHover,
    },
  },
});

export const ToggleExclude = style({



  opacity: '1',

  selectors: {
    '&:hover': {
      backgroundColor: color.Critical.ContainerHover,
    },





      width: '140%',
      height: toRem(2),
      backgroundColor: color.Critical.Main,
      transform: 'translate(-50%, -50%) rotate(-45deg)',
      pointerEvents: 'none',
    },
  },
});

export const SortButton = style({




  height: TOGGLE_SIZE,
  paddingInlineStart: config.space.S200,
  paddingInlineEnd: config.space.S200,






  transition: transition(['background-color', 'border-color'], motion.duration.Normal),

  selectors: {
    '&:hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
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

  selectors: {
    '&:hover': {
      backgroundColor: color.Primary.ContainerHover,
    },
  },
});

export const PauseButtonActive = style({



  opacity: '1',

  selectors: {
    '&:hover': {
      backgroundColor: color.Warning.ContainerHover,
    },
  },
});

// ─── Tag filters (right side of toolbar) ────────────────────────────────────

export const TagRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: config.space.S100,
  marginInlineStart: 'auto',
  flexWrap: 'wrap',
});

export const TagList = style({
  display: 'flex',



});

const TAG_PILL_HEIGHT = toRem(26);

export const TagPill = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: TAG_PILL_HEIGHT,




  overflow: 'hidden',
  transition: transition(['background-color', 'border-color'], motion.duration.Normal),
});

export const TagPillInclude = style({
  backgroundColor: color.Success.Container,
  borderColor: color.Success.ContainerLine,
  color: color.Success.OnContainer,
});

export const TagPillExclude = style({



});

export const TagPillLabel = style({
  background: 'none',




  font: 'inherit',
  whiteSpace: 'nowrap',
  selectors: {
    '&:hover': {
      opacity: '0.8',
    },
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '-2px',
    },
  },
});

export const TagPillRemove = style({
  background: 'none',
  border: 'none',
  borderInlineStart: `${config.borderWidth.B300} solid currentColor`,



  font: 'inherit',
  opacity: '0.6',
  height: '100%',




      opacity: '1',
    },
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '-2px',
    },
  },
});

export const AddTagContainer = style({
  position: 'relative',
  display: 'inline-flex',
});

export const AddTagButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: TAG_PILL_HEIGHT,
  paddingInlineStart: config.space.S200,
  paddingInlineEnd: config.space.S200,
  borderRadius: config.radii.Pill,
  border: `${config.borderWidth.B300} dashed ${color.SurfaceVariant.ContainerLine}`,





  transition: transition(['opacity'], motion.duration.Normal),
  font: 'inherit',
  selectors: {
    '&:hover': {
      opacity: '1',
    },
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
});

export const AddTagDropdown = style({
  position: 'absolute',
  top: `calc(${TAG_PILL_HEIGHT} + ${config.space.S100})`,
  insetInlineEnd: 0,
  zIndex: 100,
  minWidth: toRem(140),
  maxHeight: toRem(200),
  overflowY: 'auto',
  borderRadius: config.radii.R300,

  padding: config.space.S100,
});

export const AddTagOption = style({
  display: 'block',
  width: '100%',






  textAlign: 'start',
  font: 'inherit',




    },
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: '-2px',
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



  height: TOGGLE_SIZE,
  paddingInlineStart: config.space.S200,
  paddingInlineEnd: config.space.S200,






  font: 'inherit',
  transition: transition(['background-color', 'border-color'], motion.duration.Normal),
  selectors: {
    '&:hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
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
  borderRadius: config.radii.R300,

  padding: config.space.S100,
});

export const PresetOption = style({
  display: 'block',
  width: '100%',






  textAlign: 'start',
  font: 'inherit',




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



  width: TOGGLE_SIZE,
  height: TOGGLE_SIZE,
  minWidth: TOGGLE_SIZE,





  padding: 0,
  font: 'inherit',
  transition: transition(['background-color'], motion.duration.Normal),
  selectors: {
    '&:hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
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



});

export const SearchInput = style({



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



  padding: `${config.space.S400} ${config.space.S200}`,
  color: color.SurfaceVariant.OnContainer,
});

export const ResetLink = style({



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
