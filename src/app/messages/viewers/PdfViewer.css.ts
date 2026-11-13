import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config } from 'folds';

export const PdfViewer = style([
  DefaultReset,
  {
    width: '100%',
    height: '100%',
    minHeight: 0,
    backgroundColor: color.Surface.Container,
    color: color.Surface.OnContainer,
  },
]);

export const PdfViewerHeader = style({
  paddingInline: config.space.S200,
  borderBottom: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  flexShrink: 0,
  gap: config.space.S200,
});

export const PdfViewerContent = style({
  minHeight: 0,
  backgroundColor: color.SurfaceVariant.Container,
});
