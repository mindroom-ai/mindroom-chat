import { ReactNode } from 'react';
import { Box } from 'folds';
import * as css from './SidebarContent.css';

type RailSections = {
  /** The rail items that scroll when the window is short. */
  scrollable: ReactNode;
  /** The rail items pinned to the bottom, above the safe area. */
  sticky: ReactNode;
};

/**
 * Splits the rail into a scrolling part and a part pinned to its foot. In a short rail
 * (`shortRail`) the rail scrolls as a whole and the foot group scrolls with it.
 */
export function SidebarContent({ scrollable, sticky }: RailSections) {
  return (
    <>
      <Box direction="Column" grow="Yes" className={css.SidebarScrollPart}>
        {scrollable}
      </Box>
      <Box
        direction="Column"
        shrink="No"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {sticky}
      </Box>
    </>
  );
}
