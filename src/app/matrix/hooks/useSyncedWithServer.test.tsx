// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, renderHook } from '@testing-library/react';
import { ClientEvent, type MatrixClient, SyncState } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { useSyncedWithServer } from './useSyncedWithServer';

const clientIn = (state: SyncState | null) => {
  let syncState = state;
  const client = Object.assign(new EventEmitter(), { getSyncState: () => syncState });
  const report = (next: SyncState) =>
    act(() => {
      const before = syncState;
      syncState = next;
      client.emit(ClientEvent.Sync, next, before);
    });
  return { mx: client as unknown as MatrixClient, report };
};

describe('useSyncedWithServer', () => {
  it('is false for a client that only read its stored copy, until the server answers', () => {
    const { mx, report } = clientIn(SyncState.Prepared);
    const { result } = renderHook(() => useSyncedWithServer(mx));
    expect(result.current).toBe(false);

    report(SyncState.Syncing);
    expect(result.current).toBe(true);
  });

  it('is true from the start for a client that is syncing', () => {
    const { mx } = clientIn(SyncState.Syncing);
    expect(renderHook(() => useSyncedWithServer(mx)).result.current).toBe(true);
  });

  it('stays true when the connection is lost afterwards', () => {
    const { mx, report } = clientIn(SyncState.Syncing);
    const { result } = renderHook(() => useSyncedWithServer(mx));
    report(SyncState.Reconnecting);
    report(SyncState.Error);
    expect(result.current).toBe(true);
  });

  it('is not synced by a failed first sync', () => {
    const { mx, report } = clientIn(null);
    const { result } = renderHook(() => useSyncedWithServer(mx));
    report(SyncState.Error);
    report(SyncState.Reconnecting);
    expect(result.current).toBe(false);
  });
});
