import { createContext, useContext } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';

/** The started client of the active account; `ClientRoot` provides it. */
const ActiveClientContext = createContext<MatrixClient | undefined>(undefined);

export const MatrixClientProvider = ActiveClientContext.Provider;

/** The active account's client. Only components rendered under `MatrixClientProvider` may call it. */
export function useMatrixClient(): MatrixClient {
  const mx = useContext(ActiveClientContext);
  if (mx === undefined) throw new Error('useMatrixClient called outside MatrixClientProvider');
  return mx;
}
