import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config } from 'folds';






    flexDirection: 'column',
  },
]);

export const TextViewerHeader = style({
  paddingInline: config.space.S200,
  paddingInlineStart: config.space.S400,
  gap: config.space.S200,
  flexShrink: 0,
});

// The code canvas fills the scroll area, gutter and empty space below short text included.
export const TextViewerContent = style({
  flexGrow: 1,
  minHeight: 0,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
});

export const TextViewerPre = style({
  margin: 0,
  padding: config.space.S400,
  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
  fontSize: '0.875rem',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  tabSize: 4,
  background: 'transparent',
});
