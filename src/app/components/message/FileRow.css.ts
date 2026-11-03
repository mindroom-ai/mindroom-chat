import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const FileRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S300,
  padding: `${config.space.S200} ${config.space.S200} ${config.space.S200} ${config.space.S300}`,
});

export const FileTile = style({



  height: toRem(44),



  placeItems: 'end center',
  paddingBottom: toRem(6),
  fontSize: toRem(11),
  fontWeight: config.fontWeight.W700,
  letterSpacing: '0.02em',
});

export const FileInfo = style({
  minWidth: 0,




});

export const FileName = style({
  fontWeight: config.fontWeight.W600,
});
