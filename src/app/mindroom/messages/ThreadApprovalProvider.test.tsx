import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { createClient, MatrixEvent, MatrixEventEvent, Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CryptoBackend } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import {
  ThreadApprovalProvider,
  ThreadApprovals,
  useThreadApprovals,
} from './ThreadApprovalProvider';

const mocks = vi.hoisted(() => ({ backfill: vi.fn(), abort: vi.fn() }));
let mx: ReturnType<typeof createClient>;
let room: Room;
let ignored: string[];
const IgnoredContext = React.createContext<string[] | undefined>(undefined);
const scheduler = { abort: mocks.abort };
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../../hooks/useIgnoredUsers', () => ({
  useIgnoredUsers: () => React.useContext(IgnoredContext) ?? ignored,
}));
vi.mock('../engine', () => ({
  enqueueThreadApprovalBackfill: mocks.backfill,
  useMindroomSyncEngine: () => ({ scheduler }),
}));
vi.mock('../threads/roomLiveEventArrive', () => ({ useLiveEventArrive: () => undefined }));
let current: ThreadApprovals;
let renderer: ReactTestRenderer;
function Probe() {
  current = useThreadApprovals()!;
  return null;
}
const content = {
  approval_id: 'one',
  tool_name: 'invite',
  agent_name: 'assistant',
  arguments: { user: 'Jamie' },
  status: 'pending',
  requested_at: '2026-09-12T12:00:00Z',
  expires_at: '2999-09-12T12:00:00Z',
  thread_id: '$thread',
};
const event = (id = '$approval', value = content) =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: '@router:example.org',
    origin_server_ts: 1,
    type: 'io.mindroom.tool_approval',
    content: value,
  });
const mount = async () => {
  await act(async () => {
    renderer = create(
      <ThreadApprovalProvider room={room} threadId="$thread">
        <Probe />
      </ThreadApprovalProvider>
    );
  });
};

beforeEach(() => {
  mocks.backfill.mockReset().mockResolvedValue({ events: [], repairedEventIds: [] });
  mocks.abort.mockReset();
  ignored = [];
  mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@alice:example.org' });
  room = new Room('!room:example.org', mx, '@alice:example.org');
  mx.store.storeRoom(room);
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('thread approval provider lifecycle', () => {
  it('repairs a late-decrypted offscreen origin once through its direct SDK event subscription', async () => {
    const encrypted = new MatrixEvent({
      ...event().event,
      type: 'm.room.encrypted',
      content: { ciphertext: 'late keys' },
    });
    await encrypted.attemptDecryption({
      decryptEvent: async () => {
        throw new Error('Missing room key');
      },
    } as CryptoBackend);
    expect(encrypted.isDecryptionFailure()).toBe(true);
    const unreadableMessage = new MatrixEvent({
      ...event('$unreadable').event,
      type: 'm.room.encrypted',
      content: { ciphertext: 'another missing key' },
    });
    await unreadableMessage.attemptDecryption({
      decryptEvent: async () => {
        throw new Error('Missing room key');
      },
    } as CryptoBackend);
    mocks.backfill.mockResolvedValueOnce({
      events: [encrypted, unreadableMessage],
      repairedEventIds: [],
    });
    const edit = new MatrixEvent({
      ...event('$edit').event,
      origin_server_ts: 2,
      content: {
        'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
        'm.new_content': { ...content, status: 'approved' },
      },
    });
    mocks.backfill.mockResolvedValueOnce({ events: [edit], repairedEventIds: ['$approval'] });
    await mount();
    expect(current.records).toEqual([]);
    expect(current.loading).toBe(false);
    expect(current.error).toContain('decrypt');
    expect(encrypted.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);
    await act(async () => {
      await encrypted.attemptDecryption({
        decryptEvent: async () => ({ clearEvent: { type: 'io.mindroom.tool_approval', content } }),
      } as CryptoBackend);
    });
    expect(mocks.backfill).toHaveBeenCalledTimes(2);
    expect(mocks.backfill.mock.calls[1][4]).toEqual([encrypted]);
    expect(current.records[0].approval.status).toBe('approved');
    // A successful targeted repair cannot conceal another unreadable event.
    expect(current.error).toContain('decrypt');
    await act(async () => {
      await unreadableMessage.attemptDecryption({
        decryptEvent: async () => ({
          clearEvent: { type: 'm.room.message', content: { body: 'Hello' } },
        }),
      } as CryptoBackend);
    });
    expect(current.error).toBeUndefined();
    expect(unreadableMessage.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
    await act(async () => {
      encrypted.emit(MatrixEventEvent.Decrypted, encrypted);
    });
    expect(mocks.backfill).toHaveBeenCalledTimes(2);
    act(() => renderer.unmount());
    expect(encrypted.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
  });
  it('retains newer bundled replacements when an older fetch completes and removes ignored senders', async () => {
    let finish!: (value: { events: MatrixEvent[]; repairedEventIds: string[] }) => void;
    mocks.backfill.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await mount();
    await act(async () => {
      current.ingest([event()]);
    });
    const updated = event();
    updated.makeReplaced(
      new MatrixEvent({
        ...event('$edit').event,
        origin_server_ts: 2,
        content: {
          'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
          'm.new_content': { ...content, status: 'approved' },
        },
      })
    );
    await act(async () => {
      current.ingest([updated]);
      finish({ events: [event()], repairedEventIds: ['$approval'] });
    });
    expect(current.records[0].approval.status).toBe('approved');
    ignored = ['@router:example.org'];
    await act(async () => {
      renderer.update(
        <ThreadApprovalProvider room={room} threadId="$thread">
          <Probe />
        </ThreadApprovalProvider>
      );
    });
    expect(current.records).toEqual([]);
  });
  it('settles local expiry at its deadline without a Matrix edit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    mocks.backfill.mockResolvedValue({
      events: [event('$approval', { ...content, expires_at: '2026-09-12T12:00:02Z' })],
      repairedEventIds: ['$approval'],
    });
    await mount();
    expect(current.records[0].approval.status).toBe('pending');
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(current.records[0].approval.status).toBe('expired');
  });
});

it('keeps a submitted request in review past local expiry until Matrix acknowledges it', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
  vi.spyOn(mx, 'sendEvent').mockResolvedValue({ event_id: '$response' });
  const origin = event('$approval', { ...content, expires_at: '2026-09-12T12:00:02Z' });
  mocks.backfill.mockResolvedValue({ events: [origin], repairedEventIds: ['$approval'] });
  await mount();
  await act(async () => {
    await current.submit(current.records[0], { status: 'approved' });
  });
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  expect(current.actions.get('$approval')?.status).toBe('submitted');
  expect(current.pendingEventIds.has('$approval')).toBe(true);
  await act(async () => {
    current.ingest([
      new MatrixEvent({
        ...event('$decision').event,
        origin_server_ts: 2,
        content: {
          'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
          'm.new_content': { ...origin.getContent(), status: 'approved' },
        },
      }),
    ]);
  });
  expect(current.records[0].approval.status).toBe('approved');
  expect(current.actions.size).toBe(0);
  expect(current.pendingEventIds.size).toBe(0);
});

it('keeps failed discovery visible after a successful targeted repair until full retry succeeds', async () => {
  const encrypted = new MatrixEvent({
    ...event().event,
    type: 'm.room.encrypted',
    content: { ciphertext: 'late keys' },
  });
  const discoveryError = 'Some approval history could not be loaded.';
  mocks.backfill.mockResolvedValueOnce({
    events: [encrypted],
    repairedEventIds: [],
    error: discoveryError,
  });
  mocks.backfill.mockResolvedValueOnce({ events: [], repairedEventIds: ['$approval'] });
  await mount();
  expect(current.error).toBe(discoveryError);
  await act(async () => {
    await encrypted.attemptDecryption({
      decryptEvent: async () => ({ clearEvent: { type: 'io.mindroom.tool_approval', content } }),
    } as CryptoBackend);
  });
  expect(mocks.backfill).toHaveBeenCalledTimes(2);
  expect(mocks.backfill.mock.calls[1][4]).toEqual([encrypted]);
  expect(current.error).toBe(discoveryError);
  mocks.backfill.mockResolvedValueOnce({ events: [encrypted], repairedEventIds: ['$approval'] });
  await act(async () => current.refresh());
  expect(mocks.backfill.mock.calls[2][4]).toBeUndefined();
  expect(current.error).toBeUndefined();
});

it('does not retain ciphertext from another thread and releases decoded non-approval events', async () => {
  const unrelated = new MatrixEvent({
    ...event('$unrelated').event,
    type: 'm.room.encrypted',
    content: { 'm.relates_to': { rel_type: 'm.thread', event_id: '$other' } },
  });
  const relevant = new MatrixEvent({
    ...event('$relevant').event,
    type: 'm.room.encrypted',
    content: { 'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' } },
  });
  await mount();
  await act(async () => {
    current.ingest([unrelated, relevant]);
  });
  expect(unrelated.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
  expect(relevant.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);
  await act(async () => {
    await relevant.attemptDecryption({
      decryptEvent: async () => ({
        clearEvent: { type: 'm.room.message', content: { body: 'Hello' } },
      }),
    } as CryptoBackend);
  });
  expect(relevant.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
});

it('keeps send completion bound to committed records during a suspended transition', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let finish!: (value: { event_id: string }) => void;
  vi.spyOn(mx, 'sendEvent').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  mocks.backfill.mockResolvedValue({ events: [event()], repairedEventIds: ['$approval'] });
  const suspended = new Promise<void>(() => {});
  const hiddenUsers = ['@router:example.org'];
  const visibleUsers: string[] = [];
  let attemptedHiddenRender = false;
  function Gate({ block }: { block: boolean }) {
    if (block) {
      attemptedHiddenRender = true;
      throw suspended;
    }
    return null;
  }
  const tree = (block: boolean) => (
    <React.Suspense fallback={null}>
      <IgnoredContext.Provider value={block ? hiddenUsers : visibleUsers}>
        <ThreadApprovalProvider room={room} threadId="$thread">
          <Probe />
          <Gate block={block} />
        </ThreadApprovalProvider>
      </IgnoredContext.Provider>
    </React.Suspense>
  );
  await act(async () => {
    renderer = create(tree(false), { unstable_isConcurrent: true } as Parameters<typeof create>[1]);
  });
  let sending!: Promise<void>;
  await act(async () => {
    sending = current.submit(current.records[0], { status: 'approved' });
  });
  await act(async () => {
    React.startTransition(() => renderer.update(tree(true)));
  });
  expect(attemptedHiddenRender).toBe(true);
  await act(async () => {
    finish({ event_id: '$response' });
    await sending;
  });
  await act(async () => renderer.update(tree(false)));
  expect(current.records).toHaveLength(1);
  expect(current.actions.get('$approval')?.status).toBe('submitted');
});
