import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  ClientEvent,
  createClient,
  MatrixEvent,
  type IEvent,
  type MatrixClient,
  type Room,
  type Thread,
} from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import {
  createBackfillScheduler,
  SyncEngineProvider,
  type BackfillScheduler,
  type SyncEngine,
} from '../../event-store/engine';
import { threadForkContent } from '../../event-store/threads/threadFork';
import { useThreadForkPrefix } from './useThreadForkPrefix';

vi.mock('../../matrix/session/useSessionStore', () => ({ useActiveSession: () => undefined }));

const roomId = '!room:example.org';
const bob = '@bob:example.org';

const raw = (eventId: string, ts: number, threadRoot?: string, content = {}): IEvent =>
  ({
    event_id: eventId,
    room_id: roomId,
    sender: bob,
    type: 'm.room.message',
    origin_server_ts: ts,
    unsigned: {},
    content: {
      msgtype: 'm.text',
      body: eventId,
      ...(threadRoot ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadRoot } } : {}),
      ...content,
    },
  } as IEvent);

const message = (...args: Parameters<typeof raw>) => new MatrixEvent(raw(...args));

/** A new instance of the fork's root each call: it forks `$p` at `$b`. */
const forkRoot = () =>
  message('$f', 10, undefined, threadForkContent({ threadId: '$p', eventId: '$b' }));

const ids = (events: MatrixEvent[]) => events.map((event) => event.getId());

/** A room holding `$p`'s events; with `sdkThread`, an SDK thread for `$p` loaded from its start. */
const makeRoom = (parentEvents: MatrixEvent[], sdkThread: boolean) => {
  const timeline = {
    getEvents: () => parentEvents,
    getNeighbouringTimeline: () => null,
    getPaginationToken: () => null,
  };
  const thread = {
    id: '$p',
    rootEvent: parentEvents[0],
    initialEventsFetched: true,
    events: parentEvents,
    getUnfilteredTimelineSet: () => ({ getLiveTimeline: () => timeline }),
  } as unknown as Thread;
  return {
    roomId,
    getThread: (threadId: string) => (sdkThread && threadId === '$p' ? thread : null),
    findEventById: (eventId: string) => parentEvents.find((event) => event.getId() === eventId),
  } as unknown as Room;
};

const newClient = () => createClient({ baseUrl: 'https://example.org', userId: '@me:example.org' });

/** Renders the hook for `root`; `setRoot` renders the same component with another root. */
const renderPrefix = async (
  room: Room,
  mx: MatrixClient,
  scheduler: BackfillScheduler,
  root: MatrixEvent
) => {
  const results: ReturnType<typeof useThreadForkPrefix>[] = [];
  let mounts = 0;
  const Probe = ({ shownRoot }: { shownRoot: MatrixEvent }) => {
    results.push(useThreadForkPrefix(room, shownRoot));
    useEffect(() => {
      mounts += 1;
    }, []);
    return null;
  };
  const engine = { scheduler } as unknown as SyncEngine;
  const tree = (shownRoot: MatrixEvent) => (
    <MatrixClientProvider value={mx}>
      <SyncEngineProvider engine={engine}>
        <Probe shownRoot={shownRoot} />
      </SyncEngineProvider>
    </MatrixClientProvider>
  );
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(tree(root));
  });
  return {
    results,
    mounts: () => mounts,
    setRoot: (next: MatrixEvent) =>
      act(async () => {
        renderer?.update(tree(next));
      }),
    unmount: () =>
      act(async () => {
        renderer?.unmount();
      }),
  };
};

describe('useThreadForkPrefix', () => {
  it('shows an edit a prefix message gets in the parent without remounting', async () => {
    const parentEvents = [
      message('$p', 1),
      message('$a', 2, '$p'),
      message('$b', 3, '$p'),
      message('$c', 4, '$p'),
    ];
    const mx = newClient();
    const view = await renderPrefix(
      makeRoom(parentEvents, true),
      mx,
      {} as BackfillScheduler,
      forkRoot()
    );
    const loaded = view.results.at(-1)!;
    expect(loaded.loading).toBe(false);
    expect(ids(loaded.events)).toEqual(['$p', '$a', '$b']);
    expect(loaded.parent).toEqual({ threadId: '$p', eventId: '$b' });

    const edit = message('$edit', 20, undefined, {
      body: '* edited',
      'm.new_content': { msgtype: 'm.text', body: 'edited' },
      'm.relates_to': { rel_type: 'm.replace', event_id: '$a' },
    });
    await act(async () => {
      mx.emit(ClientEvent.Event, edit);
    });

    const edited = view.results.at(-1)!;
    expect(edited.events).not.toBe(loaded.events);
    expect(ids(edited.events)).toEqual(['$p', '$a', '$b']);
    expect(edited.events[1]!.getContent().body).toBe('edited');
    expect(view.mounts()).toBe(1);
    await view.unmount();
  });

  it('gets the prefix when a new root instance joins the backfill still running', async () => {
    const mx = newClient();
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchRelations = vi.spyOn(mx, 'fetchRelations').mockImplementation(async () => {
      await released;
      return { chunk: [raw('$c', 4, '$p'), raw('$b', 3, '$p'), raw('$a', 2, '$p')] };
    });
    const view = await renderPrefix(
      makeRoom([message('$p', 1)], false),
      mx,
      createBackfillScheduler(),
      forkRoot()
    );
    expect(fetchRelations).toHaveBeenCalledTimes(1);

    await view.setRoot(forkRoot());
    await act(async () => {
      release();
    });

    expect(fetchRelations).toHaveBeenCalledTimes(1);
    const last = view.results.at(-1)!;
    expect(last.loading).toBe(false);
    expect(ids(last.events)).toEqual(['$p', '$a', '$b']);
    expect(last.complete).toBe(true);
    await view.unmount();
  });

  it('keeps a backfill that stopped before the thread start, as incomplete', async () => {
    const page = {
      events: [message('$a', 2, '$p'), message('$b', 3, '$p'), message('$c', 4, '$p')],
      nextBatchToken: 'x',
    };
    const scheduler = { enqueue: () => Promise.resolve(page) } as unknown as BackfillScheduler;
    const view = await renderPrefix(
      makeRoom([message('$p', 1)], false),
      newClient(),
      scheduler,
      forkRoot()
    );
    const last = view.results.at(-1)!;
    expect(last.loading).toBe(false);
    expect(ids(last.events)).toEqual(['$p', '$a', '$b']);
    expect(last.complete).toBe(false);
    await view.unmount();
  });
});
