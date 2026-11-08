import { EventEmitter } from 'events';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { ClientEvent, MatrixClient, SyncState } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncStatus } from './SyncStatus';
import {
  bindSyncStallWatch,
  createSyncStallWatch,
  SYNC_STALL_MARGIN_MS,
} from '../matrix/client/syncStall';

vi.mock('../native/cloudflareAccess', () => ({
  useCloudflareAccessSignInRequired: () => false,
}));

const SYNC_URL = 'https://matrix.example/_matrix/client/v3/sync?timeout=30000&since=s1';

/** What the status region reads out. */
const announced = (renderer: ReactTestRenderer): string =>
  renderer.root.findByProps({ 'data-sync-status-announcement': true }).children.join('');

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
    const text = () => announced(renderer!);
    act(() => {
      mx.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing, {});
    });

    const stuck = watch.fetchFn(SYNC_URL);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000 + SYNC_STALL_MARGIN_MS - 1);
    });
    expect(text()).toBe('');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(text()).toBe('Connection Lost!');

    await act(async () => {
      answers.shift()?.(new Response('{}'));
      await stuck;
    });
    expect(text()).toBe('');
  });
});
