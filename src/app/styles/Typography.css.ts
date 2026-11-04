import { globalStyle } from '@vanilla-extract/css';
import { config, configClass } from 'folds';

// Headings track tighter than folds' 0, as in docs/design/reference/. Each value is fit at 1x:
// Home (H4, home.png), the welcome title (H2, home.png), and the room name and member count in
// the header (H5, room-light.png) then match the reference's width and ink to the pixel. Sizes
// without a reference sample keep folds' spacing. The doubled class outranks folds' own rule.
globalStyle(`.${configClass}.${configClass}`, {
  vars: {
    [config.letterSpacing.H2]: '-0.4px',
    [config.letterSpacing.H4]: '-0.2px',
    [config.letterSpacing.H5]: '-0.15px',
  },
});
