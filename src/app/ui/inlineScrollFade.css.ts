import { createVar, style } from '@vanilla-extract/css';

/** How far the fade at a scrolling edge reaches. */
const fadeLength = '1.5rem';
const fadeStart = createVar();
const fadeEnd = createVar();

// The first layer fades the row's content toward each edge it has more beyond; the second keeps
// the row's bottom line, such as a divider border, whole.
const mask = (toward: 'right' | 'left') =>
  `linear-gradient(to ${toward}, transparent, #000 ${fadeStart}, #000 calc(100% - ${fadeEnd}), transparent), linear-gradient(#000, #000)`;
const masked = (toward: 'right' | 'left') => ({
  maskImage: mask(toward),
  WebkitMaskImage: mask(toward),
  maskSize: '100% 100%, 100% 1px',
  maskPosition: '0 0, 0 100%',
  maskRepeat: 'no-repeat',
});

const scrolls = '&:is([data-more-start], [data-more-end])';

/**
 * A row that scrolls sideways (useInlineScrollFade marks it) fades out toward each edge it has
 * more to show beyond, in reading order, so the cut-off end says that the row scrolls.
 */
export const InlineScrollFade = style({
  vars: { [fadeStart]: '0px', [fadeEnd]: '0px' },
  scrollPaddingInline: fadeLength,
  selectors: {
    '&[data-more-start]': { vars: { [fadeStart]: fadeLength } },
    '&[data-more-end]': { vars: { [fadeEnd]: fadeLength } },
    [scrolls]: masked('right'),
    [`${scrolls}:dir(rtl)`]: masked('left'),
  },
});
