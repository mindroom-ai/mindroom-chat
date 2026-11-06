import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const Note = style({
  display: 'block',
  paddingBottom: config.space.S300,
});

export const Empty = style({
  display: 'block',
  padding: `${config.space.S700} 0`,
  textAlign: 'center',
});

export const TableScroll = style({
  maxWidth: '100%',
  overflowX: 'auto',
  containerType: 'inline-size',
});

// Too narrow for seven columns (a phone): each canvas is a block, its pin beside the rest.
const narrow = '(max-width: 40rem)';

export const Table = style({
  width: '100%',
  borderCollapse: 'collapse',
});

globalStyle(`${Table} th, ${Table} td`, {
  padding: `${config.space.S200} ${config.space.S300}`,
  textAlign: 'start',
  verticalAlign: 'middle',
  borderBottom: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
});

globalStyle(`${Table} th`, {
  fontWeight: 500,
  whiteSpace: 'nowrap',
});

// The dates stay on one line; titles and room names wrap.
globalStyle(`${Table} td:nth-child(n + 6)`, {
  whiteSpace: 'nowrap',
});

globalStyle(`${Table}, ${Table} tbody`, {
  '@container': { [narrow]: { display: 'block' } },
});

// The header row's names label each cell instead.
globalStyle(`${Table} thead`, {
  '@container': {
    [narrow]: {
      position: 'absolute',
      width: 1,
      height: 1,
      overflow: 'hidden',
      clipPath: 'inset(50%)',
    },
  },
});

globalStyle(`${Table} tr`, {
  '@container': {
    [narrow]: {
      display: 'grid',
      gridTemplateColumns: 'auto minmax(0, 1fr)',
      columnGap: config.space.S300,
      padding: `${config.space.S200} 0`,
      borderBottom: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
    },
  },
});

globalStyle(`${Table} td`, {
  '@container': {
    [narrow]: {
      display: 'block',
      gridColumn: 2,
      padding: `${config.space.S100} 0`,
      borderBottom: 'none',
    },
  },
});

globalStyle(`${Table} td:first-child`, {
  '@container': { [narrow]: { gridColumn: 1, gridRow: '1 / span 6' } },
});

// A canvas shown in the room itself has no thread: no empty line for it.
globalStyle(`${Table} td:empty`, {
  '@container': { [narrow]: { display: 'none' } },
});

globalStyle(`${Table} td[data-label]::before`, {
  '@container': {
    [narrow]: {
      content: 'attr(data-label)',
      display: 'block',
      color: color.Surface.OnContainer,
      opacity: config.opacity.P400,
      fontSize: toRem(12),
    },
  },
});

export const Link = style({
  padding: 0,
  border: 'none',
  background: 'none',
  color: 'inherit',
  textAlign: 'start',
  cursor: 'pointer',
  maxWidth: toRem(360),
  // Generated titles hold long tokens; they wrap rather than run past the edge.
  overflowWrap: 'anywhere',
  selectors: {
    '&:hover, &:focus-visible': {
      textDecoration: 'underline',
    },
  },
});
