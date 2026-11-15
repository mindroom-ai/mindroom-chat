import { style } from '@vanilla-extract/css';
import { SectionTitle } from './ThreadApprovals.css';

/** "GitHub key": a long service name ends in an ellipsis before it pushes the chip out. */
export const Title = style([
  SectionTitle,
  { flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
]);

/** The agent's reason, as it wrote it. */
export const Reason = style({ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });
