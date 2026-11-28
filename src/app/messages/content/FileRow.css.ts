import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { glassOutline, glassSurface } from '../../ui/styles/Glass.css';

// A file is a glass card in the conversation, like paste attachments and link previews.
export const FileCard = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  {
    minInlineSize: 0,
    borderRadius: config.radii.R400,
    color: color.SurfaceVariant.OnContainer,
  },
]);

export const FileRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S300,
  paddingBlock: config.space.S200,
  paddingInline: `${config.space.S300} ${config.space.S200}`,
});

export const FilePreview = style({
  overflow: 'hidden',
  borderEndStartRadius: config.radii.R400,
  borderEndEndRadius: config.radii.R400,
});

export const FilePreviewLoading = style({
  display: 'grid',
  placeItems: 'center',
  // Five code lines plus the toolbar.
  blockSize: toRem(140),
  borderBlockStart: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

// Pinned and search previews outline their file card; the line stays when glass is off.
export const FileRowOutlined = glassOutline;

export const FileTile = style({
  display: 'grid',
  flex: '0 0 auto',
  inlineSize: toRem(36),
  blockSize: toRem(44),
  borderRadius: config.radii.R300,
  color: color.Primary.OnContainer,
  background: color.Primary.Container,
  placeItems: 'end center',
  paddingBlockEnd: toRem(6),
  fontSize: toRem(11),
  fontWeight: config.fontWeight.W700,
  letterSpacing: '0.02em',
});

export const FileInfo = style({
  minInlineSize: 0,
  flex: '1 1 auto',
  display: 'flex',
  flexDirection: 'column',
  rowGap: toRem(2),
});

export const FileName = style({
  fontWeight: config.fontWeight.W600,
});
