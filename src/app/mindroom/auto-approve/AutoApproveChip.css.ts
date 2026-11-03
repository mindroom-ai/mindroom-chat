import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

// A thread header status chip in the warning tone: tool calls here run without approval cards.
export const Chip = style({



  minWidth: 0,
  maxWidth: '100%',
  padding: 'calc(0.1rem - 1px) calc(0.4rem - 1px)',
  border: `1px solid ${color.Warning.ContainerLine}`,
  borderRadius: '0.5rem',
  backgroundColor: color.Warning.Container,
  color: color.Warning.OnContainer,
  fontSize: '0.65rem',
  fontWeight: 500,
  lineHeight: 1.4,




  selectors: {
    '&:hover': { backgroundColor: color.Warning.ContainerHover },
    '&:focus-visible': {
      outline: `2px solid ${color.Warning.Main}`,
      outlineOffset: 1,
    },
  },
});

export const ChipIcon = style({
  flexShrink: 0,
  width: '0.85rem',
  height: '0.85rem',
});
