import React from 'react';
import { Box, as, config, toRem } from 'folds';

/**
 * The row naming a sidebar section ("ROOMS", "THREADS"), usually holding the button that folds
 * it. Plain page chrome: no surface of its own, so it takes the sidebar's color.
 */
export const NavCategoryHeader = as<'div'>(({ style, ...props }, ref) => (
  <Box
    alignItems="Center"
    gap="100"
    shrink="No"
    {...props}
    style={{
      minHeight: toRem(32),
      paddingInline: config.space.S100,
      ...style,
    }}
    ref={ref}
  />
));
