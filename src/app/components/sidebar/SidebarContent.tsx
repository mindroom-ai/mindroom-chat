import React, { ReactNode } from 'react';
import { Box } from 'folds';












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
