// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SecretStorageKeyTuple } from 'matrix-js-sdk/lib/secret-storage';
import { useDefaultSecretStorageKey } from './useDefaultSecretStorageKey';

const client = vi.hoisted(() => ({
  secretStorage: { getKey: vi.fn() },
  listener: undefined as ((event: { getType: () => string }) => void) | undefined,
  on: vi.fn(),
  off: vi.fn(),
}));
client.on.mockImplementation((_event: string, fn: typeof client.listener) => {
  client.listener = fn;
});
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));

const deferred = () => {
  let resolve!: (tuple: SecretStorageKeyTuple | null) => void;
  const promise = new Promise<SecretStorageKeyTuple | null>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const tuple = (keyId: string) =>
  [keyId, { algorithm: 'm.secret_storage.v1.aes-hmac-sha2' }] as never;

afterEach(cleanup);

describe('useDefaultSecretStorageKey', () => {
  it('keeps the newest read when an older one answers last', async () => {
    const first = deferred();
    const second = deferred();
    client.secretStorage.getKey
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useDefaultSecretStorageKey());

    act(() => client.listener?.({ getType: () => 'm.secret_storage.default_key' }));
    await act(async () => second.resolve(tuple('new')));
    await act(async () => first.resolve(tuple('old')));

    expect(result.current?.[0]).toBe('new');
  });
});
