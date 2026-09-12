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
  width: 'fit-content',
  maxWidth: 'min(100%, 42rem)',
  minWidth: 0,
  fontSize: 12,
  lineHeight: 1.5,
  color: color.SurfaceVariant.OnContainer,
  background: color.SurfaceVariant.Container,
  border: `1px solid ${color.Surface.ContainerLine}`,
  borderRadius: 6,
  selectors: { '&[open]': { width: '100%' } },
});
globalStyle(`${Receipt} > summary`, {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
  padding: '4px 8px',
  fontWeight: 500,
  listStyle: 'none',
});
globalStyle(`${Receipt} > summary::-webkit-details-marker`, { display: 'none' });
globalStyle(`${Receipt} > summary::before`, { content: '"›"' });
globalStyle(`${Receipt}[open] > summary::before`, { content: '"⌄"' });
globalStyle(`${Receipt} > summary > span:first-of-type`, {
  flex: 1,
  minWidth: 0,
  overflowWrap: 'anywhere',
});
globalStyle(`${Receipt} > summary > span:last-of-type`, {
  whiteSpace: 'nowrap',
  fontWeight: 400,
  opacity: 0.7,
});
export const ReceiptTool = style({ fontFamily: 'var(--font-mono)' });
export const ReceiptBody = style({
  padding: '6px 8px 8px',
  borderTop: `1px solid ${color.Surface.ContainerLine}`,
  fontSize: 13,
  overflowWrap: 'anywhere',
});
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
globalStyle(`${HistoryBody} > ${Receipt}`, {
  width: '100%',
  maxWidth: '100%',
  background: 'transparent',
  border: 0,
  borderRadius: 0,
});
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
