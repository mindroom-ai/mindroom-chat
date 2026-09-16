import { style } from '@vanilla-extract/css';
import { glassFlat, glassFloating, glassSurface } from '../../../styles/Glass.css';

// Continuous chrome uses native blur, without the optical filter's refractive rim.
export const Header = style([
  glassSurface({ level: 'panel', variant: 'Background' }),
  glassFlat,
  glassFloating,
  {
    position: 'sticky',
    top: 0,
    zIndex: 1,
  },
]);
