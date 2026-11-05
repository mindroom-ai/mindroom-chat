import { Box, as, config, toRem } from 'folds';

/**
 * The row naming a sidebar section ("ROOMS", "THREADS"), usually holding the button that folds
 * it. Plain page chrome: no surface of its own, so it takes the sidebar's color. It is a heading
 * under the column's title, so screen readers can jump between sections; a fold button inside
 * keeps its own role, as in an accordion.
 */
export const NavCategoryHeader = as<'div'>(({ style, ...props }, ref) => (
  <Box
    alignItems="Center"
    gap="100"
    shrink="No"
    role="heading"
    aria-level={3}
    {...props}
    style={{
      minHeight: toRem(32),
      paddingInline: config.space.S100,
      ...style,
    }}
    ref={ref}
  />
));
