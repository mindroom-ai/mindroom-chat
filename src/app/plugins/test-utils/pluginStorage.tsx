// The accounts and the storage hook of the plugin storage tests.
import { renderHook } from '@testing-library/react';
import type { MatrixClient } from 'matrix-js-sdk';
import type { ReactNode } from 'react';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { putSession } from '../../matrix/session/sessions';
import { usePluginStorage } from '../pluginStorage';

export const ALICE = '@alice:example.org';
export const BOB = '@bob:example.org';
// A user ID that starts with Alice's names another account.
export const LOOKALIKE = `${ALICE}.other`;

export const signIn = (userId: string) =>
  putSession({
    baseUrl: 'https://matrix.example.org',
    userId,
    deviceId: 'DEVICE',
    accessToken: 'token',
  });

/** `pluginId`'s storage, as a component of it sees it while `userId` is signed in. */
export const storageOf = (pluginId: string, userId: string) => {
  const client = { getSafeUserId: () => userId } as unknown as MatrixClient;
  return renderHook(() => usePluginStorage(pluginId), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MatrixClientProvider value={client}>{children}</MatrixClientProvider>
    ),
  }).result.current;
};
