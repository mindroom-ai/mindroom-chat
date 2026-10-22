import { style } from '@vanilla-extract/css';
import { color } from 'folds';

// Sized like the header's active-permissions chip, in the warning tone since nothing asks first.
// It shrinks with an ellipsis on a narrow header, and its title keeps the whole text.
export const Chip = style({
  border: `1px solid ${color.Warning.ContainerLine}`,
  borderRadius: 16,
  background: color.Warning.Container,
  color: color.Warning.OnContainer,
  padding: '5px 10px',
  fontSize: 12,
  whiteSpace: 'nowrap',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});
