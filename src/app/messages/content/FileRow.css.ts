import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { glassOutline, glassSurface } from '../../ui/styles/Glass.css';

// A file is a glass card in the conversation, like paste attachments and link previews.
export const FileRow = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  {
    display: 'flex',
    alignItems: 'center',
    gap: config.space.S300,
    paddingBlock: config.space.S200,
    paddingInline: `${config.space.S300} ${config.space.S200}`,
    borderRadius: config.radii.R400,
    color: color.SurfaceVariant.OnContainer,
  },
]);

// Pinned and search previews outline their file card; the line stays when glass is off.
export const FileRowOutlined = glassOutline;

export const FileTile = style({
  display: 'grid',
  flex: '0 0 auto',
  width: toRem(36),
  height: toRem(44),
  borderRadius: config.radii.R300,
  color: color.Primary.OnContainer,
  background: color.Primary.Container,
  placeItems: 'end center',
  paddingBottom: toRem(6),
  fontSize: toRem(11),
  fontWeight: config.fontWeight.W700,
  letterSpacing: '0.02em',
});

export const FileInfo = style({
  minWidth: 0,
  flex: '1 1 auto',
  display: 'flex',
  flexDirection: 'column',
  rowGap: toRem(2),
});

export const FileName = style({
  fontWeight: config.fontWeight.W600,
});
