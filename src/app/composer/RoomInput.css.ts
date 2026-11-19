import { style } from '@vanilla-extract/css';
import { touchTarget } from '../ui/styles/touchTarget';

/** The composer's icon buttons, 32 px with 4 px between them: 44 px tall and 36 px wide to a finger. */
export const ComposerIconButton = style(touchTarget('2px'));

/** A picker in the composer's row (Home's agent and room): its choice, then a chevron. */
export const ComposerPickerButton = style([
  touchTarget('2px'),
  {
    width: 'auto',
    minWidth: 0,
    maxWidth: '11.25rem',
    gap: '0.375rem',
    paddingInline: '0.5rem',
    flexShrink: 1,
  },
]);

/** Send on a phone, alone beside the text box: 44 px wide to a finger too. */
export const ComposerLoneButton = style(touchTarget('6px'));

/** The rows of the phone composer's "More actions" menu, 44 px tall so each takes a finger. */
export const ComposerMenuItem = style({ minHeight: '44px' });
