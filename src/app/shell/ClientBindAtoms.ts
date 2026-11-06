import React, { ReactNode, useEffect, useLayoutEffect, useState } from 'react';
import { useStore } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useBindAtoms } from './useBindAtoms';
import { forgetAccountState } from './accountState';

type ClientBindAtomsProps = { children: ReactNode };

/**
 * Seeds the account-wide atoms (rooms, invites, unread counts, ...) from the
 * active Matrix client. Children render only once the seeding effects of that
 * client ran, so no page ever reads atoms that still hold another account.
 * When the account's pages go, everything they kept for it goes too
 * (`accountState.ts`); this runs before the pages' own cleanups.
 */
export function ClientBindAtoms({ children }: ClientBindAtomsProps) {
  const client = useMatrixClient();
  const store = useStore();
  useEffect(() => () => forgetAccountState(store), [store]);
  useBindAtoms(client);

  const [seededFor, setSeededFor] = useState<MatrixClient | undefined>(undefined);

  // A layout effect, so the pages render before the browser paints: an update from a layout
  // effect renders again at once, and React runs the binding hooks' effects (the seeding) first.
  // A passive effect here let the browser paint the empty first render between the splash and
  // the shell.
  useLayoutEffect(() => {
    setSeededFor(client);
  }, [client]);

  if (seededFor !== client) return null;
  return React.createElement(React.Fragment, null, children);
}
