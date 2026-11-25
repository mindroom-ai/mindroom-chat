import { keyframes, style } from '@vanilla-extract/css';
import { color, config } from 'folds';
import { footerInset } from '../../ui/styles/RoomOverlay.css';

const countdown = keyframes({
  from: { transform: 'scaleX(1)' },
  to: { transform: 'scaleX(0)' },
});

export const Error = style({
  color: color.Critical.Main,
});

const barHeader = {
  alignItems: 'center',
  backgroundColor: color.SurfaceVariant.Container,
  borderBottom: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  display: 'flex',
  gap: config.space.S200,
  justifyContent: 'space-between',
  padding: `${config.space.S200} ${config.space.S300}`,
} as const;

const compactWrap = {
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: config.space.S100,
} as const;

export const Notice = style({
  ...barHeader,
  flex: '0 0 auto',
});

export const Staged = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  width: '100%',
});

export const AnswerCard = style({
  backgroundColor: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  borderRadius: config.radii.R300,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
  overflow: 'hidden',
  padding: `${config.space.S200} ${config.space.S300}`,
  position: 'relative',
  width: '100%',
  selectors: {
    '&[data-auto-send]': { borderColor: color.Primary.ContainerLine },
    '&:focus:not(:focus-visible)': { outline: 'none' },
  },
  ':focus-visible': { outline: `2px solid ${color.Primary.Main}`, outlineOffset: '2px' },
});

export const CountdownTrack = style({
  backgroundColor: color.Primary.Main,
  blockSize: '2px',
  insetBlockStart: 0,
  insetInline: 0,
  pointerEvents: 'none',
  position: 'absolute',
  transformOrigin: '0% 50%',
  selectors: { '[dir="rtl"] &': { transformOrigin: '100% 50%' } },
  '@media': {
    '(prefers-reduced-motion: no-preference)': {
      animationFillMode: 'forwards',
      animationName: countdown,
      animationTimingFunction: 'linear',
    },
  },
});

export const StagedRow = style({
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: config.space.S200,
});

export const StagedInfo = style({
  ...compactWrap,
  display: 'flex',
  flex: '1 1 12rem',
  minWidth: 0,
});

export const IconLine = style({
  alignItems: 'center',
  display: 'inline-flex',
  gap: config.space.S100,
  minWidth: 0,
});

export const SrOnly = style({
  clipPath: 'inset(50%)',
  height: 1,
  overflow: 'hidden',
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: 1,
});

export const StatusDot = style({
  backgroundColor: color.Secondary.Main,
  blockSize: '8px',
  borderRadius: '50%',
  flexShrink: 0,
  inlineSize: '8px',
  selectors: { '[data-auto-send] &': { backgroundColor: color.Primary.Main } },
});

export const Chips = style({
  ...compactWrap,
  display: 'inline-flex',
  minWidth: 0,
});

export const Chip = style({
  backgroundColor: color.Surface.Container,
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  borderRadius: config.radii.R300,
  color: color.Surface.OnContainer,
  fontSize: config.fontSize.T200,
  lineHeight: config.lineHeight.T200,
  maxInlineSize: '14rem',
  overflow: 'hidden',
  padding: `0 ${config.space.S100}`,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const StagedActions = style({
  ...compactWrap,
  display: 'flex',
  marginInlineStart: 'auto',
});

export const Data = style({
  backgroundColor: color.Surface.Container,
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  borderRadius: config.radii.R300,
  fontFamily: 'monospace',
  fontSize: '0.75rem',
  margin: 0,
  maxBlockSize: '10rem',
  overflow: 'auto',
  padding: `${config.space.S100} ${config.space.S200}`,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
});

// A themed page in the thread can be far taller than the screen.
export const StickyAnswer = style({
  // Above the room's composer, which floats over the end of the conversation, and above Jump to
  // Latest, which floats S400 over the composer and is 44 px tall to a finger.
  bottom: `calc(${footerInset} + ${config.space.S400} + 44px + ${config.space.S200})`,
  boxShadow: config.shadow.E300,
  position: 'sticky',
  zIndex: 1,
});

export const SentIcon = style({
  color: color.Success.Main,
  flexShrink: 0,
});

// No overflow: hidden; CanvasAnswerBar's StickyAnswer uses position: sticky.
export const InlineCard = style({
  backgroundColor: color.Surface.Container,
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  borderRadius: config.radii.R400,
  boxSizing: 'border-box',
  marginBlockStart: config.space.S100,
  minWidth: 0,
  width: '100%',
});

export const InlineCardHeader = style({
  ...barHeader,
  borderStartEndRadius: `calc(${config.radii.R400} - ${config.borderWidth.B300})`,
  borderStartStartRadius: `calc(${config.radii.R400} - ${config.borderWidth.B300})`,
});

export const InlineCardTitle = style({
  alignItems: 'center',
  display: 'flex',
  flex: '1 1 auto',
  gap: config.space.S200,
  minWidth: 0,
});

export const InlineCardControls = style({
  alignItems: 'center',
  display: 'flex',
  flexShrink: 0,
  gap: config.space.S100,
});

export const InlineCardInfo = style({
  alignItems: 'center',
  backgroundColor: 'transparent',
  border: 'none',
  borderRadius: config.radii.R300,
  color: color.SurfaceVariant.OnContainer,
  cursor: 'pointer',
  display: 'inline-flex',
  justifyContent: 'center',
  opacity: config.opacity.P300,
  padding: config.space.S100,
  ':hover': { backgroundColor: color.SurfaceVariant.ContainerHover, opacity: 1 },
  ':focus-visible': {
    opacity: 1,
    outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
    outlineOffset: '1px',
  },
});

export const InlineCardAction = style({
  flexShrink: 0,
});

export const InlineCardNote = style({
  backgroundColor: color.SurfaceVariant.Container,
  borderBottom: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  padding: `${config.space.S100} ${config.space.S300}`,
});

export const InlineCardBody = style({
  padding: config.space.S200,
});
