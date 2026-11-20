import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const { space, radii, borderWidth } = config;
const stack = { display: 'flex', flexFlow: 'column nowrap' } as const;
const strip = { display: 'flex', flexFlow: 'row nowrap', alignItems: 'center' } as const;
const focusRing = `${borderWidth.B400} solid ${color.Primary.Main}`;

export const Top = style({ ...stack, rowGap: space.S200, padding: `${space.S200} ${space.S300}` });

export const TitleRow = style({ ...strip, columnGap: space.S200 });

// The groups: positioned, so a row that left fades at its old place among them (`useListMotion`).
export const Groups = style({ ...stack, position: 'relative' });

export const GroupHeading = style({
  ...strip,
  columnGap: space.S100,
  paddingBlock: `${space.S300} ${space.S100}`,
  paddingInline: space.S300,
  color: color.Background.OnContainer,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
});

export const Row = style({
  // Positioned, so a row that travels far passes over the others.
  position: 'relative',
  display: 'flex',
  columnGap: space.S200,
  inlineSize: '100%',
  padding: `${space.S200} ${space.S300}`,
  border: 0,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'start',
  cursor: 'pointer',
  borderRadius: radii.R400,
  selectors: {
    '&:hover': { backgroundColor: color.Background.ContainerHover },
    '&[aria-current=page]': { backgroundColor: color.Primary.Container },
    '&:focus-visible': { outline: focusRing, outlineOffset: `calc(-1 * ${borderWidth.B400})` },
  },
});

/** A read thread: its title in regular weight, the rest as on an unread one. */
export const RowRead = style({});

export const Body = style({ ...stack, flexGrow: 1, minInlineSize: 0, rowGap: toRem(2) });

export const Line = style({ ...strip, columnGap: space.S100, minInlineSize: 0 });

export const Grow = style({ flexGrow: 1, minInlineSize: 0 });

/** The row's end: the time over the new count. */
export const Side = style({ ...stack, alignItems: 'flex-end', rowGap: toRem(2), flexShrink: 0 });

export const LiveDot = style({
  flexShrink: 0,
  inlineSize: toRem(7),
  blockSize: toRem(7),
  borderRadius: '50%',
  backgroundColor: color.Success.Main,
});

export const Muted = style({});

export const Empty = style({
  ...stack,
  alignItems: 'center',
  textAlign: 'center',
  rowGap: space.S200,
  padding: `${space.S700} ${space.S500}`,
});
