import { style } from '@vanilla-extract/css';
import { color } from 'folds';
import { touchTarget } from '../ui/styles/touchTarget';

const noSelect = {
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
} as const;

/** The composer's icon buttons, 32 px with 4 px between them: 44 px tall and 36 px wide to a finger. */
export const ComposerIconButton = style([touchTarget('2px'), noSelect]);

/** A picker in the composer's row (Home's agent and room): its choice, then a chevron. */
export const ComposerPickerButton = style([
  touchTarget('2px'),
  {
    width: 'auto',
    minWidth: 0,
    maxWidth: '11.25rem',
    gap: '0.25rem',
    paddingInline: '0.375rem',
    flexShrink: 1,
    fontSize: '0.875rem',
  },
]);

/** Send on a phone, alone beside the text box: 44 px wide to a finger too. */
export const ComposerLoneButton = style([touchTarget('6px'), noSelect]);

export const ComposerSendMenu = style(noSelect);

/** The rows of the phone composer's "More actions" menu, 44 px tall so each takes a finger. */
export const ComposerMenuItem = style({ minHeight: '44px' });

/** Highlights the composer frame in Warning amber while composing an unsent fork draft. */
export const ComposerForkDraft = style({
  selectors: {
    '&&&::before': { display: 'none' },
    '&&&': {
      boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${color.Warning.Main} 65%, transparent), 0 2px 8px rgb(0 0 0 / 5%)`,
    },
    '&&&:focus-within': {
      boxShadow: `inset 0 0 0 2px ${color.Warning.Main}, 0 2px 8px rgb(0 0 0 / 5%)`,
    },
  },
});
