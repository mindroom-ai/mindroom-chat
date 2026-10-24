import { style } from '@vanilla-extract/css';
import { HeaderChip } from '../messages/ThreadApprovals.css';

// A status chip that only informs, in the neutral tone.
export const Chip = style([HeaderChip, { cursor: 'default', fontVariantNumeric: 'tabular-nums' }]);
