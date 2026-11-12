import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

/** The field's outline, a hairline in the line colour of the chrome it sits on. */
const fieldOutline = `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`;

/**
 * A button drawn as a text field, on the rail's colour (the phone's top bar, a sidebar list): a
 * shade off its surface, ruled and rounded, in its text colour.
 */
export const SearchField = style([
  DefaultReset,
  {
    minInlineSize: 0,
    blockSize: toRem(36),
    display: 'flex',
    alignItems: 'center',
    columnGap: config.space.S200,
    paddingInline: config.space.S300,
    background: color.Background.ContainerHover,
    borderBlock: fieldOutline,
    borderInline: fieldOutline,
    borderRadius: config.radii.R400,
    // A text field's pointer and alignment, though it is a button.
    color: 'inherit',
    cursor: 'text',
    textAlign: 'start',
    selectors: {
      '&:focus-visible': { outline: `${toRem(2)} solid ${color.Primary.Main}`, outlineOffset: 0 },
    },
  },
]);

/** The placeholder, which gives way first when the field is narrow. */
export const SearchPlaceholder = style({ flexGrow: 1, minInlineSize: 0, opacity: 0.7 });

/** In a sidebar list: the rows' width, a little apart from the first row below it. */
export const NavSearchField = style({ inlineSize: '100%', marginBlockEnd: config.space.S200 });
