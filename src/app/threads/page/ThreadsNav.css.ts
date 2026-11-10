import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const { space, radii, borderWidth } = config;
const stack = { display: 'flex', flexFlow: 'column nowrap' } as const;
const strip = { display: 'flex', flexFlow: 'row nowrap', alignItems: 'center' } as const;
const focusRing = `${borderWidth.B400} solid ${color.Primary.Main}`;

export const Top = style({ ...stack, rowGap: space.S200, padding: `${space.S200} ${space.S300}` });

export const TitleRow = style({ ...strip, columnGap: space.S200 });

/** The Mine / Following / All switch, a segmented control. */
export const Scopes = style({
  display: 'inline-flex',
  flexShrink: 0,
  padding: toRem(2),
  columnGap: toRem(2),
  borderRadius: radii.R400,
  backgroundColor: color.SurfaceVariant.Container,
});

export const Scope = style({
  padding: `${toRem(4)} ${space.S200}`,
  border: 0,
  borderRadius: radii.R300,
  background: 'transparent',
  color: color.SurfaceVariant.OnContainer,
  font: 'inherit',
  fontSize: toRem(13),
  cursor: 'pointer',
  selectors: {
    '&[aria-checked=true]': {
      backgroundColor: color.Surface.Container,
      color: color.Surface.OnContainer,
      fontWeight: 600,
    },
    '&:focus-visible': { outline: focusRing },
  },
});

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
