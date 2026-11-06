import { EventEmitter } from 'events';
import React from 'react';
import { act, create, ReactTestRenderer, ReactTestRendererJSON } from 'react-test-renderer';
import { ClientEvent, MatrixClient, SyncState } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncStatus } from './SyncStatus';
import {
  bindSyncStallWatch,
  createSyncStallWatch,
  SYNC_STALL_MARGIN_MS,
} from '../matrix/client/syncStall';

vi.mock('../ui/styles/ContainerColor.css', () => ({
  ContainerColor: () => 'container-color',
}));

vi.mock('../native/cloudflareAccess', () => ({
  useCloudflareAccessSignInRequired: () => false,
}));

const SYNC_URL = 'https://matrix.example/_matrix/client/v3/sync?timeout=30000&since=s1';

const textOf = (node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null): string => {
  if (node === null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  return (node.children ?? []).map(textOf).join('');
};

describe('SyncStatus with a /sync that gets no answer', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
    vi.useRealTimers();
  });

  it('shows the lost connection while the SDK still reports syncing, and clears on the next answer', async () => {
    const mx = Object.assign(new EventEmitter(), {
      getHomeserverUrl: () => 'https://matrix.example',
    }) as unknown as MatrixClient;
    const answers: Array<(response: Response) => void> = [];
    const watch = createSyncStallWatch(
      () => new Promise<Response>((resolve) => answers.push(resolve))
    );
    bindSyncStallWatch(mx, watch);
    act(() => {
      renderer = create(<SyncStatus mx={mx} />);
    });
    const text = () => textOf(renderer!.toJSON());
    act(() => {
      mx.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing, {});
    });

    const stuck = watch.fetchFn(SYNC_URL);
    await act(() => vi.advanceTimersByTimeAsync(30_000 + SYNC_STALL_MARGIN_MS - 1));
    expect(text()).toBe('');
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(text()).toBe('Connection Lost!');

    await act(async () => {
      answers.shift()?.(new Response('{}'));
      await stuck;
    });
    expect(text()).toBe('');
  });
});
