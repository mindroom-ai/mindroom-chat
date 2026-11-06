import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// Larger screens center the dialog clear of the status bar and the home indicator, so it never
// slides under a notch and its shadow stays off the strip the page shows there.
export const SafeOverlayCenter = style({
  paddingTop: 'env(safe-area-inset-top, 0px)',
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
});

// A phone dialog that keeps its margin floats like the larger screens' one, a little in from every
// edge and from the notch and the home indicator; its height stays at the dialog's own maximum.
// Safe-area insets are physical edges of the screen, so these sides stay physical in every
// language.
const phoneMargin = (safeAreaInset: string) => `calc(${safeAreaInset} + ${config.space.S400})`;

export const PhoneInsetOverlayCenter = style({
  paddingTop: phoneMargin('env(safe-area-inset-top, 0px)'),
  paddingRight: phoneMargin('env(safe-area-inset-right, 0px)'),
  paddingBottom: phoneMargin('env(safe-area-inset-bottom, 0px)'),
  paddingLeft: phoneMargin('env(safe-area-inset-left, 0px)'),
});

// A list of a few accounts needs about 480 px, not the 800 px of the settings dialog. A phone's
// dialog that fills its screen still fills it (PhoneModal wins).
export const NarrowModal = style({
  selectors: {
    '&&': {
      maxWidth: `min(${toRem(480)}, calc(100% - 2 * ${config.space.S400}))`,
    },
  },
});

// On phones a dialog that fills the screen is a screen of its own: no margin, rounded corners or
// border, and its content kept clear of the notch and the home indicator.
export const PhoneOverlayCenter = style({
  padding: 0,
  alignItems: 'stretch',
  justifyContent: 'stretch',
});

// Opaque, unlike the glass it has elsewhere: nothing of the page behind is left to show through,
// and the blurred page would only blur into the dialog's own rows.
export const PhoneModal = style({
  selectors: {
    '&&&': {
      width: '100%',
      height: '100%',
      maxWidth: 'none',
      maxHeight: 'none',
      borderRadius: 0,
      border: 'none',
      paddingTop: 'env(safe-area-inset-top, 0px)',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      paddingLeft: 'env(safe-area-inset-left, 0px)',
      paddingRight: 'env(safe-area-inset-right, 0px)',
      backgroundColor: color.Background.Container,
      backgroundImage: 'none',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
      boxShadow: 'none',
    },
    '&&&::before': { display: 'none' },
  },
});
