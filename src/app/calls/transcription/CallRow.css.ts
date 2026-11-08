import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { glassSurface } from '../../ui/styles/Glass.css';

const quiet = color.SurfaceVariant;

/** A card as wide as its content, up to a readable width, inside any message layout. */
export const Row = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  {
    display: 'flex',
    flexDirection: 'column',
    alignSelf: 'flex-start',
    gap: config.space.S200,
    width: 'fit-content',
    minWidth: 0,
    maxWidth: `min(100%, ${toRem(560)})`,
    paddingBlock: config.space.S200,
    paddingInline: config.space.S300,
    borderRadius: config.radii.R400,
    color: quiet.OnContainer,
  },
]);

export const Header = style({
  alignItems: 'center',
  columnGap: config.space.S200,
  display: 'flex',
  minWidth: 0,
  flexWrap: 'wrap',
  rowGap: toRem(2),
});

export const Title = style({ fontWeight: 500 });

const wrapRow = { display: 'flex', flexWrap: 'wrap' } as const;
const listReset = { listStyle: 'none', margin: 0, padding: 0 } as const;

export const People = style([wrapRow, { alignItems: 'center', gap: config.space.S200 }]);

export const Faces = style([wrapRow, listReset, { gap: config.space.S100 }]);

export const Actions = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: config.space.S200,
});

/** The way to the transcript message: a quiet link-like button under the header. */
export const Link = style({
  alignSelf: 'flex-start',
  padding: 0,
  border: 0,
  font: 'inherit',
  color: color.Primary.Main,
  background: 'none',
  cursor: 'pointer',
  borderRadius: config.radii.R300,
  selectors: {
    '&:hover': { textDecoration: 'underline' },
    '&:focus-visible': {
      outline: `${config.borderWidth.B400} solid ${color.Primary.Main}`,
      outlineOffset: toRem(1),
    },
  },
});
