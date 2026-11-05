import { style } from '@vanilla-extract/css';
import { touchTarget } from '../ui/styles/touchTarget';

/** The composer's icon buttons, 32 px with 4 px between them: 44 px tall and 36 px wide to a finger. */
export const ComposerIconButton = style(touchTarget('2px'));
