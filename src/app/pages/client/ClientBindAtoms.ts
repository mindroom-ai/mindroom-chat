import React, { ReactNode, useEffect, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useBindAtoms } from '../../state/hooks/useBindAtoms';















  const [boundClient, setBoundClient] = useState<MatrixClient | undefined>(undefined);

  // Declared after the binding hooks, so it runs after their effects seeded the atoms.
  useEffect(() => {
    setBoundClient(mx);
  }, [mx]);

  if (boundClient !== mx) return null;
  return React.createElement(React.Fragment, null, children);
}
