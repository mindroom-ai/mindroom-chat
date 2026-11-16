import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ClientEvent, createClient, MatrixEvent, type Room, type Thread } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { SyncEngineProvider, type SyncEngine } from '../../event-store/engine';
import { threadForkContent } from '../../event-store/threads/threadFork';
import { useThreadForkPrefix } from './useThreadForkPrefix';

vi.mock('../../matrix/session/useSessionStore', () => ({ useActiveSession: () => undefined }));

const roomId = '!room:example.org';
const bob = '@bob:example.org';

const message = (eventId: string, ts: number, threadRoot?: string, content = {}) =>
  new MatrixEvent({
    event_id: eventId,
    room_id: roomId,
    sender: bob,
    type: 'm.room.message',
    origin_server_ts: ts,
    content: {
      msgtype: 'm.text',
      body: eventId,
      ...(threadRoot ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadRoot } } : {}),
      ...content,
    },
  });

/** A parent thread the SDK loaded from its start: its root, two replies, and one after the fork. */
const setup = () => {
  const parentRoot = message('$p', 1);
  const parentEvents = [
    parentRoot,
    message('$a', 2, '$p'),
    message('$b', 3, '$p'),
    message('$c', 4, '$p'),
  ];
  const timeline = {
    getEvents: () => parentEvents,
    getNeighbouringTimeline: () => null,
    getPaginationToken: () => null,
  };
  const thread = {
    id: '$p',
    rootEvent: parentRoot,
    initialEventsFetched: true,
    events: parentEvents,
    getUnfilteredTimelineSet: () => ({ getLiveTimeline: () => timeline }),
  } as unknown as Thread;
  const room = {
    roomId,
    getThread: (threadId: string) => (threadId === '$p' ? thread : null),
    findEventById: (eventId: string) => parentEvents.find((event) => event.getId() === eventId),
  } as unknown as Room;
  const fork = threadForkContent({ threadId: '$p', eventId: '$b' });
  const forkRoot = message('$f', 10, undefined, fork);
  const mx = createClient({ baseUrl: 'https://example.org', userId: '@me:example.org' });
  const engine = { scheduler: {} } as unknown as SyncEngine;
  return { room, forkRoot, mx, engine };
};

describe('useThreadForkPrefix', () => {
  it('shows an edit a prefix message gets in the parent without remounting', async () => {
    const { room, forkRoot, mx, engine } = setup();
    const results: ReturnType<typeof useThreadForkPrefix>[] = [];
    let mounts = 0;
    const Probe = () => {
      results.push(useThreadForkPrefix(room, forkRoot));
      useEffect(() => {
        mounts += 1;
      }, []);
      return null;
    };
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <SyncEngineProvider engine={engine}>
            <Probe />
          </SyncEngineProvider>
        </MatrixClientProvider>
      );
    });
    const loaded = results.at(-1)!;
    expect(loaded.loading).toBe(false);
    expect(loaded.events.map((event) => event.getId())).toEqual(['$p', '$a', '$b']);
    expect(loaded.parent).toEqual({ threadId: '$p', eventId: '$b' });

    const edit = new MatrixEvent({
      event_id: '$edit',
      room_id: roomId,
      sender: bob,
      type: 'm.room.message',
      origin_server_ts: 20,
      content: {
        msgtype: 'm.text',
        body: '* edited',
        'm.new_content': { msgtype: 'm.text', body: 'edited' },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$a' },
      },
    });
    await act(async () => {
      mx.emit(ClientEvent.Event, edit);
    });

    const edited = results.at(-1)!;
    expect(edited.events).not.toBe(loaded.events);
    expect(edited.events.map((event) => event.getId())).toEqual(['$p', '$a', '$b']);
    expect(edited.events[1]!.getContent().body).toBe('edited');
    expect(mounts).toBe(1);
    await act(async () => renderer?.unmount());
  });
});
