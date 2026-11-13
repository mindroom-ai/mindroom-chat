import { useEffect, useMemo, useState } from 'react';
import { useStore, type Atom } from 'jotai';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { useOptionalClientConfig } from '../config/useClientConfig';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { createSessionId } from '../matrix/session/sessions';
import { navigationRoomsAtom } from '../matrix/state/archivedRooms';
import { mDirectAtom } from '../matrix/state/mDirectList';
import { roomToUnreadAtom } from '../matrix/state/roomToUnread';
import { hasStoredRoomViewMode, roomViewModeAtomFamily } from '../navigation/roomViewMode';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { getQuickCaptureRoomAtom } from '../preferences/quickCaptureRoom';
import { settingsAtom } from '../preferences/settings';
import { useSetting } from '../preferences/useSetting';
import { crossRoomThreadIndexAtom } from '../threads/cross-room/crossRoomThreadIndex';
import { openCaptureChannel, type CaptureChannel } from './captureChannel';
import { buildCaptureItems } from './captureItems';
import type { CaptureAction, CaptureMessage, CaptureResult, CaptureState } from './captureProtocol';
import { buildCaptureRooms } from './captureRooms';
import { readCaptureThreads } from './captureThreads';
import {
  CaptureError,
  sendCapture,
  sendCaptureReply,
  setCaptureResolved,
  type CaptureSendOptions,
} from './sendCapture';

/** The least time between two states the host pushes. */
const STATE_INTERVAL_MS = 250;
/** How long after its last hello a widget counts as listening. */
const WIDGET_SILENCE_MS = 30_000;
/** How often a listened-to state is read again with no change: resolved rows and waits lapse. */
const CLOCK_MS = 60_000;

const OK: CaptureResult = { ok: true };

/** What the host reads and runs with, as of the newest render. */
type HostContext = {
  mx: MatrixClient;
  store: ReturnType<typeof useStore>;
  roomAtom: ReturnType<typeof getQuickCaptureRoomAtom>;
  t: TFunction;
  options: CaptureSendOptions;
  navigation: ReturnType<typeof useRoomNavigate>;
};

/**
 * The widget's state: the account's rooms, and the stored room with its threads while the client
 * has it and it is in the room list.
 */
const readCaptureState = ({ mx, store, roomAtom, t }: HostContext): CaptureState => {
  const userId = mx.getSafeUserId();
  const roomIds = store.get(navigationRoomsAtom);
  const directs = store.get(mDirectAtom);
  const rooms = buildCaptureRooms(
    roomIds.flatMap((id) => {
      const room = mx.getRoom(id);
      return room
        ? [
            {
              id,
              name: room.name,
              direct: directs.has(id),
              space: room.isSpaceRoom(),
              lastActiveTs: room.getLastActiveTimestamp(),
            },
          ]
        : [];
    })
  );
  const storedId = store.get(roomAtom);
  const room = storedId && roomIds.includes(storedId) ? mx.getRoom(storedId) : null;
  if (!room) return { userId, roomId: null, rooms, items: [] };
  const now = Date.now();
  const entries = store.get(crossRoomThreadIndexAtom).entries.values();
  const threads = readCaptureThreads(mx, room, entries, t, now);
  return { userId, roomId: room.roomId, rooms, items: buildCaptureItems(threads, now) };
};

/**
 * Whether the room shows Classic. `useRoomViewMode` reads it for one room in a hook only; Classic
 * comes only from a choice the reader stored, so the stored choice tells it.
 */
const showsClassic = ({ mx, store }: HostContext, roomId: string): boolean => {
  const sessionId = createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId());
  return (
    hasStoredRoomViewMode(sessionId, roomId) &&
    store.get(roomViewModeAtomFamily(sessionId, roomId)) === 'classic'
  );
};

/** Runs one of the widget's requests on the client; a failure throws. */
const runAction = async (context: HostContext, action: CaptureAction): Promise<CaptureResult> => {
  const { mx, store, roomAtom, options, navigation } = context;
  const room = mx.getRoom(action.roomId);
  if (!room) return { ok: false, error: 'no-room' };
  switch (action.kind) {
    case 'send': {
      const entry = { text: action.text, images: action.images };
      const { threadId } = await sendCapture(mx, room, entry, options);
      if (action.open) navigation.navigateRoomThreadDirect(room.roomId, threadId);
      return { ok: true, threadId };
    }
    case 'reply':
      await sendCaptureReply(mx, room, action.threadId, action.text, options);
      return OK;
    case 'resolve':
      await setCaptureResolved(mx, room, action.threadId, action.resolved);
      return OK;
    case 'selectRoom':
      store.set(roomAtom, room.roomId);
      return OK;
    case 'open':
      // As the sidebar's thread entries open a thread: Classic shows its replies in the room.
      if (action.threadId === undefined) navigation.navigateRoom(room.roomId);
      else if (showsClassic(context, room.roomId)) {
        navigation.navigateRoom(room.roomId, action.threadId);
      } else navigation.navigateRoomThreadDirect(room.roomId, action.threadId);
      return OK;
  }
};

const failureOf = (error: unknown): CaptureResult => ({
  ok: false,
  error: error instanceof CaptureError ? error.code : 'send-failed',
});

/**
 * Serves the quick capture widget from the signed-in app, the one Matrix client: answers its hello
 * with the state, pushes the state on each change while a widget said hello in the last 30 s (at
 * most every 250 ms), runs its requests, answering each once, and says it is gone when it unmounts.
 * With no widget it only listens on the channel.
 */
export function QuickCaptureHost({ channel: givenChannel }: { channel?: CaptureChannel }): null {
  const mx = useMatrixClient();
  const store = useStore();
  const { t } = useTranslation();
  const [markdown] = useSetting(settingsAtom, 'isMarkdown');
  const linkSchemes = useOptionalClientConfig()?.messageRendering?.additionalAllowedUriSchemes;
  const navigation = useRoomNavigate();
  const userId = mx.getSafeUserId();
  const roomAtom = useMemo(() => getQuickCaptureRoomAtom(userId), [userId]);
  const [hostId] = useState(() => crypto.randomUUID());
  const context = useLatestRef<HostContext>({
    mx,
    store,
    roomAtom,
    t,
    options: { markdown, linkSchemes },
    navigation,
  });

  useEffect(() => {
    const channel = givenChannel ?? openCaptureChannel();
    if (!channel) return undefined;
    let open = true;
    let lastStateTs = 0;
    let stateTimer: ReturnType<typeof setTimeout> | undefined;
    let silenceTimer: ReturnType<typeof setTimeout> | undefined;
    let unwatch: (() => void) | undefined;

    const postState = () => {
      clearTimeout(stateTimer);
      stateTimer = undefined;
      if (!open) return;
      lastStateTs = Date.now();
      channel.post({ v: 1, type: 'state', hostId, state: readCaptureState(context.current) });
    };
    const scheduleState = () => {
      stateTimer ??= setTimeout(
        postState,
        Math.max(0, lastStateTs + STATE_INTERVAL_MS - Date.now())
      );
    };

    /** Follows what the state reads: the index, unread counts, rooms, the stored room's timeline. */
    const watch = (): (() => void) => {
      const watched: Atom<unknown>[] = [
        crossRoomThreadIndexAtom,
        roomToUnreadAtom,
        navigationRoomsAtom,
        mDirectAtom,
        roomAtom,
      ];
      const unsubscribes = watched.map((atom) => store.sub(atom, scheduleState));
      // A root nobody answered is in the room's timeline, not in the index.
      const onRoomEvent = (_event: MatrixEvent, room: Room | undefined) => {
        if (room && room.roomId === store.get(roomAtom)) scheduleState();
      };
      mx.on(RoomEvent.Timeline, onRoomEvent);
      mx.on(RoomEvent.LocalEchoUpdated, onRoomEvent);
      const clock = setInterval(scheduleState, CLOCK_MS);
      return () => {
        unsubscribes.forEach((unsubscribe) => unsubscribe());
        mx.off(RoomEvent.Timeline, onRoomEvent);
        mx.off(RoomEvent.LocalEchoUpdated, onRoomEvent);
        clearInterval(clock);
      };
    };
    const stopWatching = () => {
      unwatch?.();
      unwatch = undefined;
      clearTimeout(stateTimer);
      stateTimer = undefined;
    };

    const onHello = () => {
      postState();
      unwatch ??= watch();
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(stopWatching, WIDGET_SILENCE_MS);
    };
    const onRequest = async (id: string, action: CaptureAction) => {
      const result = await runAction(context.current, action).catch(failureOf);
      if (action.kind === 'selectRoom' && result.ok) postState();
      if (open) channel.post({ v: 1, type: 'response', id, hostId, result });
    };

    const stopListening = channel.listen((message: CaptureMessage) => {
      if (message.type === 'hello') onHello();
      else if (message.type === 'request' && message.hostId === hostId) {
        void onRequest(message.id, message.action);
      }
    });
    return () => {
      stopListening();
      stopWatching();
      clearTimeout(silenceTimer);
      channel.post({ v: 1, type: 'gone', hostId });
      open = false;
      if (!givenChannel) channel.close();
    };
  }, [context, givenChannel, hostId, mx, roomAtom, store]);

  return null;
}
