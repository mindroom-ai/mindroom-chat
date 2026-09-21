import { style, globalStyle, keyframes } from '@vanilla-extract/css';
import { color, config } from 'folds';
import { glassFloating, glassSurface } from '../../styles/Glass.css';
import * as disclosure from './MessageDisclosure.css';

export const Bar = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  glassFloating,
  {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '8px 12px',
    margin: `0 ${config.space.S400} ${config.space.S200}`,
    borderRadius: config.radii.R400,
    color: color.SurfaceVariant.OnContainer,
    flexShrink: 0,
  },
]);
export const BarStatus = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
});
export const ReviewButton = style({
  position: 'relative',
  flexShrink: 0,
  overflow: 'visible',
});
export const ReviewButtonPending = style({
  boxShadow: `0 0 0 1px ${color.Warning.Main}, 0 0 8px 1px color-mix(in srgb, ${color.Warning.Main} 20%, transparent)`,
});
const reviewPulse = keyframes({
  '0%, 100%': { opacity: 0 },
  '50%': { opacity: 0.6 },
});
export const ReviewPulse = style({
  position: 'absolute',
  inset: 0,
  borderRadius: 'inherit',
  pointerEvents: 'none',
  boxShadow: `0 0 12px 3px ${color.Warning.Main}`,
  opacity: 0,
  '@media': {
    '(prefers-reduced-motion: no-preference)': {
      animation: `${reviewPulse} 2s ease-in-out 2`,
    },
  },
});
export const Chip = style({
  border: `1px solid ${color.Surface.ContainerLine}`,
  borderRadius: 16,
  background: color.SurfaceVariant.Container,
  color: 'inherit',
  padding: '5px 10px',
  cursor: 'pointer',
  fontSize: 12,
  whiteSpace: 'nowrap',
});
export const Receipt = style([
  disclosure.Surface,
  { selectors: { '&:not(:first-child)': { marginBlockStart: config.space.S100 } } },
]);
export const ReceiptTool = style([
  disclosure.Label,
  {
    fontFamily: 'var(--font-mono)',
    selectors: {
      'details[open] > summary &': { whiteSpace: 'normal', overflowWrap: 'anywhere' },
    },
  },
]);
export const ReceiptBody = style([disclosure.Body, { fontSize: 13, overflowWrap: 'anywhere' }]);
globalStyle(`${ReceiptBody} p`, { margin: '0 0 6px' });
export const Stack = style({ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 });
export const HistoryBody = style([
  Stack,
  {
    gap: 0,
    padding: '0 6px',
    borderTop: `1px solid ${color.Surface.ContainerLine}`,
  },
]);
// The enclosing history owns the glass; its rows remain flat and unfiltered.
globalStyle(`${HistoryBody} > ${Receipt}${Receipt}`, {
  width: '100%',
  maxWidth: '100%',
  marginBlockStart: 0,
  background: 'transparent',
  border: 0,
  borderRadius: 0,
  boxShadow: 'none',
  backdropFilter: 'none',
  WebkitBackdropFilter: 'none',
});
globalStyle(`${HistoryBody} > ${Receipt}::before`, { display: 'none' });
globalStyle(`${HistoryBody} > ${Receipt}:not(:last-child)`, {
  borderBottom: `1px solid ${color.Surface.ContainerLine}`,
});
export const DialogBody = style({
  padding: config.space.S400,
  overflowY: 'auto',
  maxHeight: '70dvh',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
});
export const Group = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  {
    flexShrink: 0,
    borderRadius: config.radii.R400,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minWidth: 0,
    overflowWrap: 'anywhere',
    color: color.SurfaceVariant.OnContainer,
  },
]);
export const Actions = style({ display: 'flex', flexWrap: 'wrap', gap: 8 });

export const Call = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '8px 0',
  borderBottom: `1px solid ${color.Surface.ContainerLine}`,
});

export {
  Header as ReceiptHeader,
  Label as ReceiptLabel,
  Meta as ReceiptMeta,
  Chevron as ReceiptChevron,
} from './MessageDisclosure.css';
