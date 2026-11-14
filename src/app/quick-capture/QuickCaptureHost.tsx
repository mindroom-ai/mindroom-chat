import { useEffect, useMemo } from 'react';
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
import { markThreadAsRead } from '../notifications/readReceipts';
import { getQuickCaptureRoomAtom } from '../preferences/quickCaptureRoom';
import { settingsAtom } from '../preferences/settings';
import { useSetting } from '../preferences/useSetting';
import { crossRoomThreadIndexAtom } from '../threads/cross-room/crossRoomThreadIndex';
import { openCaptureChannel, type CaptureChannel } from './captureChannel';
import { buildCaptureItems } from './captureItems';
import {
  newCaptureId,
  type CaptureAction,
  type CaptureMessage,
  type CaptureResult,
  type CaptureRoom,
  type CaptureState,
} from './captureProtocol';
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
const NO_ROOM: CaptureResult = { ok: false, error: 'no-room' };

/** What the host reads and runs with, as of the newest render. */
type HostContext = {
  mx: MatrixClient;
  store: ReturnType<typeof useStore>;
  roomAtom: ReturnType<typeof getQuickCaptureRoomAtom>;
  t: TFunction;
  options: CaptureSendOptions;
  /** Read receipts go out private (the `hideActivity` setting). */
  hideActivity: boolean;
  navigation: ReturnType<typeof useRoomNavigate>;
};

/** The rooms the widget lists: the room list's rooms the client has, without spaces. */
const readCaptureRooms = ({ mx, store }: HostContext): CaptureRoom[] => {
  const directs = store.get(mDirectAtom);
  return buildCaptureRooms(
    store.get(navigationRoomsAtom).flatMap((id) => {
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
};

const isListed = (rooms: CaptureRoom[], roomId: string): boolean =>
  rooms.some((listed) => listed.id === roomId);

/** The widget's state: its rooms, and the stored room with its threads while it is one of them. */
const readCaptureState = (context: HostContext): CaptureState => {
  const { mx, store, roomAtom, t } = context;
  const userId = mx.getSafeUserId();
  const rooms = readCaptureRooms(context);
  const storedId = store.get(roomAtom);
  const room = storedId && isListed(rooms, storedId) ? mx.getRoom(storedId) : null;
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

/** Opens the thread as the sidebar's thread entries do: Classic shows its replies in the room. */
const openThread = (context: HostContext, roomId: string, threadId: string): void => {
  if (showsClassic(context, roomId)) context.navigation.navigateRoom(roomId, threadId);
  else context.navigation.navigateRoomThreadDirect(roomId, threadId);
};

/**
 * Runs one of the widget's requests on the client; a failure throws. A room the widget does not
 * list (left, archived, replaced) is no room, even while the client still has it.
 */
const runAction = async (context: HostContext, action: CaptureAction): Promise<CaptureResult> => {
  const { mx, store, roomAtom, options, hideActivity, navigation } = context;
  const room = mx.getRoom(action.roomId);
  if (!room || !isListed(readCaptureRooms(context), room.roomId)) return NO_ROOM;
  switch (action.kind) {
    case 'send': {
      const { text, images, threadId: started } = action;
      const entry = { text, images, ...(started === undefined ? {} : { threadId: started }) };
      const { threadId } = await sendCapture(mx, room, entry, options);
      if (action.open) {
        // The entry is posted: a thread that does not open leaves the answer as it is.
        try {
          openThread(context, room.roomId, threadId);
        } catch (error) {
          console.warn('[quick-capture] could not open the new thread', error);
        }
      }
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
      if (action.threadId === undefined) navigation.navigateRoom(room.roomId);
      else openThread(context, room.roomId, action.threadId);
      return OK;
    case 'read':
      await markThreadAsRead(mx, room.roomId, action.threadId, hideActivity);
      return OK;
  }
};

const failureOf = (error: unknown): CaptureResult =>
  error instanceof CaptureError
    ? { ok: false, error: error.code, ...(error.posted ? { posted: error.posted } : {}) }
    : { ok: false, error: 'send-failed' };

/**
 * Serves the quick capture widget from the signed-in app, the one Matrix client: answers its hello
 * with the state, pushes the state on each change while a widget said hello in the last 30 s (at
 * most every 250 ms), runs its requests, answering each once, and says it is gone when it unmounts
 * or its page goes away (a reload, a sign-out), which unmounts nothing. With no widget it only
 * listens on the channel.
 */
export function QuickCaptureHost({ channel: givenChannel }: { channel?: CaptureChannel }): null {
  const mx = useMatrixClient();
  const store = useStore();
  const { t } = useTranslation();
  const [markdown] = useSetting(settingsAtom, 'isMarkdown');
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const linkSchemes = useOptionalClientConfig()?.messageRendering?.additionalAllowedUriSchemes;
  const navigation = useRoomNavigate();
  const userId = mx.getSafeUserId();
  const roomAtom = useMemo(() => getQuickCaptureRoomAtom(userId), [userId]);
  const context = useLatestRef<HostContext>({
    mx,
    store,
    roomAtom,
    t,
    options: { markdown, linkSchemes },
    hideActivity,
    navigation,
  });

  useEffect(() => {
    const channel = givenChannel ?? openCaptureChannel();
    if (!channel) return undefined;
    // Each run serves under its own id: the run before said it is gone.
    const hostId = newCaptureId();
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
      try {
        channel.post({ v: 1, type: 'state', hostId, state: readCaptureState(context.current) });
      } catch (error) {
        // A change that set an atom must not fail for it; the widget's next hello reads it again.
        console.warn('[quick-capture] could not read the state', error);
      }
    };
    /** A change: posted at once when the last state is 250 ms old, else at the 250 ms mark. */
    const scheduleState = () => {
      if (stateTimer !== undefined) return;
      const wait = lastStateTs + STATE_INTERVAL_MS - Date.now();
      if (wait <= 0) postState();
      else stateTimer = setTimeout(postState, wait);
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
    const sayGone = () => channel.post({ v: 1, type: 'gone', hostId });

    const stopListening = channel.listen((message: CaptureMessage) => {
      if (message.type === 'hello') onHello();
      else if (message.type === 'request' && message.hostId === hostId) {
        void onRequest(message.id, message.action);
      }
    });
    window.addEventListener('pagehide', sayGone);
    return () => {
      window.removeEventListener('pagehide', sayGone);
      stopListening();
      stopWatching();
      clearTimeout(silenceTimer);
      sayGone();
      open = false;
      if (!givenChannel) channel.close();
    };
  }, [context, givenChannel, mx, roomAtom, store]);

  return null;
}
