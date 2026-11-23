import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// Home's thread rows put their titles after a 1.25rem avatar, a 0.375rem dot slot and two 0.625rem
// gaps (`shell/Home.css.ts`): a notice's icon takes the avatar's column and its text the titles'.
export const Notice = style({
  display: 'grid',
  gridTemplateColumns: `${toRem(20)} 1fr`,
  columnGap: toRem(26),
  alignItems: 'baseline',
  paddingInline: config.space.S100,
});

export const NoticeIcon = style({
  justifySelf: 'center',
  alignSelf: 'center',
  color: color.SurfaceVariant.OnContainer,
});

export const NoticeText = style({ margin: 0, minWidth: 0 });

/** A link-styled button, which Home's thread list heading uses too. */
export const NoticeAction = style({
  all: 'unset',
  cursor: 'pointer',
  color: color.Primary.Main,
  borderRadius: config.radii.R300,
  selectors: {
    '&:hover': { textDecoration: 'underline' },
    '&:focus-visible': { outline: `${config.borderWidth.B600} solid ${color.Primary.Main}` },
  },
});
