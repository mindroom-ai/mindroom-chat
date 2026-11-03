import React, { ReactNode, useEffect, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useBindAtoms } from '../../state/hooks/useBindAtoms';

type ClientBindAtomsProps = { children: ReactNode };

/**
 * Seeds the account-wide atoms (rooms, invites, unread counts, ...) from the
 * active Matrix client. Children render only once the seeding effects of that
 * client ran, so no page ever reads atoms that still hold another account.
 */




  const [boundClient, setBoundClient] = useState<MatrixClient | undefined>(undefined);

  // Declared after the binding hooks, so it runs after their effects seeded the atoms.
  useEffect(() => {
    setBoundClient(mx);
  }, [mx]);

  if (boundClient !== mx) return null;
  return React.createElement(React.Fragment, null, children);
}
