import { recipe } from '@vanilla-extract/recipes';
import { color } from 'folds';

// Paints an element with one of the folds container colours: its background, text and the
// line colour borders inside it use.
const container = (name: 'Background' | 'Surface' | 'SurfaceVariant') => ({
  vars: { '--mr-container-line': color[name].ContainerLine },
  backgroundColor: color[name].Container,
  color: color[name].OnContainer,
});

const accent = (name: 'Primary' | 'Secondary' | 'Success' | 'Warning' | 'Critical') => ({
  vars: { '--mr-container-line': color[name].ContainerLine },
  backgroundColor: color[name].Container,
  color: color[name].OnContainer,
});

export const ContainerColor = recipe({
  variants: {
    variant: {
      Background: container('Background'),
      Surface: container('Surface'),
      SurfaceVariant: container('SurfaceVariant'),
      Primary: accent('Primary'),
      Secondary: accent('Secondary'),
      Success: accent('Success'),
      Warning: accent('Warning'),
      Critical: accent('Critical'),
    },
  },
});
