import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createClient, Direction, MatrixEvent, Room, RoomEvent, type IEvent } from 'matrix-js-sdk';
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMindroomSyncEngine, type MindroomSyncEngine } from '../engine';
import { deleteCacheStoreDb, loadLatestCachedThreadEvents } from './cacheStore';
import { useThreadTimelineState } from './useThreadTimelineState';
import { useThreadGapRecovery } from './useThreadGapRecovery';
import * as cacheController from './threadOpenCacheController';

const ROOM_ID = '!recovery:example.org';
const ROOT_ID = '$root';
const USER_ID = '@alice:example.org';

const message = (id: string, body: string, threadId = ROOT_ID): Partial<IEvent> => ({
  event_id: id,
  room_id: ROOM_ID,
  sender: USER_ID,
  type: 'm.room.message',
  origin_server_ts: 10,
  content: {
    body,
    msgtype: 'm.text',
    'm.relates_to': { rel_type: 'm.thread', event_id: threadId },
  },
});

function Harness({
  engine,
  room,
  threadId,
}: {
  engine: MindroomSyncEngine;
  room: Room;
  threadId: string;
}) {
  const { threadEvents, setSupplementalThreadEvents } = useThreadTimelineState({
    room,
    threadId,
    threadInitialCacheHydrated: true,
  });
  useThreadGapRecovery({ engine, room, threadId, append: setSupplementalThreadEvents });
  return (
    <>
      {threadEvents.map((event) => (
        <span key={event.getId()}>{event.getContent().body}</span>
      ))}
    </>
  );
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

const setup = (chunks: Partial<IEvent>[][]) => {
  const fetchFn = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ chunk: chunks.shift() ?? [], ...(chunks.length ? { end: 'older' } : {}) }),
        { headers: { 'Content-Type': 'application/json' } }
      )
  );
  const mx = createClient({ baseUrl: 'https://example.org', userId: USER_ID, fetchFn });
  const room = new Room(ROOM_ID, mx, USER_ID);
  mx.store.storeRoom(room);
  room.currentState.setStateEvents([
    new MatrixEvent({
      type: 'm.room.create',
      state_key: '',
      sender: USER_ID,
      content: { creator: USER_ID },
      event_id: '$create',
      room_id: ROOM_ID,
    }),
  ]);
  room.getLiveTimeline().setPaginationToken('gap', Direction.Backward);
  const engine = createMindroomSyncEngine({ mx });
  engine.start();
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(<Harness engine={engine} room={room} threadId={ROOT_ID} />);
  });
  cleanups.push(async () => {
    act(() => renderer.unmount());
    engine.stop();
    await deleteCacheStoreDb(engine.sessionId);
  });
  const recover = () =>
    mx.emit(RoomEvent.TimelineReset, room, room.getUnfilteredTimelineSet(), false);
  return { mx, room, engine, renderer: renderer!, fetchFn, recover };
};

describe('mounted thread gap recovery', () => {
  it.each([false, true])(
    'does not lose a commit during an in-flight cache read (read fails: %s)',
    async (failRead) => {
      let releaseRead!: () => void;
      const heldRead = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      let snapshotTaken!: () => void;
      const snapshotReady = new Promise<void>((resolve) => {
        snapshotTaken = resolve;
      });
      const hydrate = cacheController.hydrateThreadFromCache;
      vi.spyOn(cacheController, 'hydrateThreadFromCache').mockImplementationOnce(
        async (...args) => {
          const page = await hydrate(...args);
          snapshotTaken();
          await heldRead;
          if (failRead) throw new Error('Read interrupted');
          return page;
        }
      );
      let releasePage!: (response: Response) => void;
      const heldPage = new Promise<Response>((resolve) => {
        releasePage = resolve;
      });
      const { fetchFn, recover, renderer, engine } = setup([]);
      fetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify({ chunk: [message('$first', 'First')], end: 'older' }))
      );
      fetchFn.mockImplementationOnce(() => heldPage);
      await act(async () => {
        recover();
        await snapshotReady;
      });
      await act(async () => {
        releasePage(new Response(JSON.stringify({ chunk: [message('$second', 'Second')] })));
        await vi.waitFor(async () =>
          expect(
            (
              await loadLatestCachedThreadEvents(engine.sessionId, ROOM_ID, ROOT_ID, 20)
            ).events
          ).toHaveLength(2)
        );
        releaseRead();
      });
      await act(async () => {
        await vi.waitFor(() => expect(JSON.stringify(renderer.toJSON())).toContain('Second'));
      });
    }
  );

  it('renders a committed missing reply and its final edit without reopening or an SDK thread', async () => {
    const reply = message('$reply', 'Working');
    reply.unsigned = {
      'm.relations': {
        'm.replace': {
          ...message('$edit', '* Sent'),
          origin_server_ts: 20,
          content: {
            'm.new_content': { body: 'Sent', msgtype: 'm.text' },
            'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
          },
        },
      },
    };
    const { room, engine, renderer, recover } = setup([
      [reply, message('$other', 'Other thread', '$elsewhere')],
    ]);
    expect(room.getThread(ROOT_ID)).toBeNull();
    await act(async () => {
      recover();
      await vi.waitFor(async () =>
        expect(
          (
            await loadLatestCachedThreadEvents(engine.sessionId, ROOM_ID, ROOT_ID, 20)
          ).events
        ).toHaveLength(1)
      );
    });
    await act(async () => {
      await vi.waitFor(() => expect(JSON.stringify(renderer.toJSON())).toContain('Sent'));
    });
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Other thread');
  });

  it('does not put a recovered reply into a different thread after navigation', async () => {
    const { renderer, engine, room, recover } = setup([[message('$reply', 'Recovered')]]);
    await act(async () => {
      recover();
      renderer.update(<Harness engine={engine} room={room} threadId="$elsewhere" />);
      await vi.waitFor(async () =>
        expect(
          (
            await loadLatestCachedThreadEvents(engine.sessionId, ROOM_ID, ROOT_ID, 20)
          ).events
        ).toHaveLength(1)
      );
    });
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Recovered');
  });
});
