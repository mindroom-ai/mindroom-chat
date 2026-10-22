import { style } from '@vanilla-extract/css';
import { color } from 'folds';
import { HeaderChip } from '../messages/ThreadApprovals.css';

// The header's active-permissions chip, in the warning tone since nothing asks first, and not a button.
export const Chip = style([
  HeaderChip,
  {
    borderColor: color.Warning.ContainerLine,
    background: color.Warning.Container,
    color: color.Warning.OnContainer,
    cursor: 'default',
  },
]);
