import React, { ReactNode } from 'react';
import { Box } from 'folds';

type RailSections = {
  /** The rail items that scroll when the window is short. */
  scrollable: ReactNode;
  /** The rail items pinned to the bottom, above the safe area. */
  sticky: ReactNode;
};

/** Splits the rail into a scrolling part and a part pinned to its foot. */
export function SidebarContent({ scrollable, sticky }: RailSections) {
  return (
    <>
      <Box direction="Column" grow="Yes" style={{ minHeight: 0 }}>
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
