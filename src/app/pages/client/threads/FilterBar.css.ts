import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { glassSurface } from '../../../styles/Glass.css';

export const Bar = style([
  DefaultReset,
  glassSurface({ level: 'panel', variant: 'Surface' }),
  {
    position: 'relative',
    zIndex: 1,
    flex: '0 0 auto',
    display: 'flex',
    flexFlow: 'row wrap',
    alignItems: 'center',
    gap: config.space.S200,
    padding: `${config.space.S200} ${config.space.S400}`,
    borderBottom: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
    background: color.Surface.Container,
  },
]);

export const Search = style({
  flex: '1 1 220px',
  minWidth: toRem(180),
});

export const Group = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
});

export const CompactInput = style({
  width: toRem(148),
});

export const DesktopControls = style({
  display: 'contents',
  '@media': {
    'screen and (max-width: 700px)': {
      display: 'none',
    },
  },
});

export const MobileControls = style({
  display: 'none',
  '@media': {
    'screen and (max-width: 700px)': {
      display: 'flex',
    },
  },
});
