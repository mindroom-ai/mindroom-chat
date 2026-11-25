import { globalStyle, style } from '@vanilla-extract/css';

// Styles for rendered Mermaid diagrams inside CodeBlock frames.
// Uses logical CSS properties only so layout mirrors cleanly in RTL locales.

export const MermaidViewport = style({
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  minBlockSize: '4rem',
  paddingBlock: '0.75rem',
  paddingInline: '0.75rem',
  overflow: 'auto',
  overscrollBehaviorInline: 'contain',
});

export const MermaidSvg = style({
  display: 'flex',
  justifyContent: 'center',
  inlineSize: '100%',
});

globalStyle(`${MermaidSvg} svg`, {
  display: 'block',
  maxInlineSize: '100%',
  blockSize: 'auto',
  marginInline: 'auto',
});

export const MermaidToggle = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  paddingInline: '0.5rem',
  fontFamily: 'inherit',
  fontSize: '0.75rem',
  fontWeight: 500,
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
});

export const MermaidStatus = style({
  display: 'inline-flex',
  alignItems: 'center',
  paddingInline: '0.375rem',
  fontSize: '0.75rem',
  lineHeight: 1.2,
  opacity: 0.65,
  whiteSpace: 'nowrap',
});
