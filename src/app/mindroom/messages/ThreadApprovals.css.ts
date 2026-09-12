import { style, globalStyle } from '@vanilla-extract/css';
import { color, config } from 'folds';

export const Bar = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '8px 12px',
  margin: '0 12px',
  borderRadius: 8,
  background: color.SurfaceVariant.Container,
  flexShrink: 0,
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
export const Receipt = style({
  width: '100%',
  minWidth: 0,
  fontSize: 13,
  color: color.Surface.OnContainer,
  borderRadius: 6,
});
globalStyle(`${Receipt} > summary`, {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  cursor: 'pointer',
  padding: '7px 10px',
  background: color.SurfaceVariant.Container,
  borderRadius: 6,
});
globalStyle(`${Receipt} > summary::before`, { content: '"›"' });
globalStyle(`${Receipt}[open] > summary::before`, { content: '"⌄"' });
globalStyle(`${Receipt} > summary > span:first-of-type`, {
  flex: 1,
  minWidth: 0,
  overflowWrap: 'anywhere',
});
export const ReceiptBody = style({ padding: 12, overflowWrap: 'anywhere' });
globalStyle(`${ReceiptBody} p`, { margin: '0 0 8px' });
export const Stack = style({ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 });
export const DialogBody = style({
  padding: config.space.S400,
  overflowY: 'auto',
  maxHeight: '70dvh',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
});
export const Group = style({
  flexShrink: 0,
  border: `1px solid ${color.Surface.ContainerLine}`,
  borderRadius: 10,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  minWidth: 0,
  overflowWrap: 'anywhere',
});
export const Actions = style({ display: 'flex', flexWrap: 'wrap', gap: 8 });

export const Call = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '8px 0',
  borderBottom: `1px solid ${color.Surface.ContainerLine}`,
});
export const CallHeader = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
});
