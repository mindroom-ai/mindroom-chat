import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { atom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { RoomStateEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { MatrixRTCSessionEvent } from 'matrix-js-sdk/lib/matrixrtc';
import type { CallDevices, CallState, RoomCall } from './RoomCall';
import { activeMemberships, type CallMember } from './callMemberships';
import { takeDeviceCallLock } from './callResume';

/** Where an agent call came from: the room and thread the agent is told about and posts back to. */
export type CallOrigin = { roomId: string; threadId?: string };

/** The call this device is in. One at a time. */
export type ActiveCall = {
  call: RoomCall;
  /** `agent`: a MindRoom agent's call room, opened from another conversation. */
  kind: 'room' | 'agent';
  agentUserId?: string;
  origin?: CallOrigin;
  /**
   * Server time of the newest event in the call room when the call started; failure notices
   * at or before it belong to an earlier call in the same room.
   */
  startedAfterTs?: number;
  /** Runs after the membership is withdrawn, such as an agent call room's cleanup. */
  onEnded?: () => Promise<void>;
};

export const activeCallAtom = atom<ActiveCall | undefined>(undefined);

/** The room whose call panel is open (the call's room, or an agent call's origin room). */
export const callPanelRoomAtom = atom<string | undefined>(undefined);

export const useActiveCall = () => useAtomValue(activeCallAtom);

/** A call is starting in this tab; a second start would race it for the one call. */
const callStartingAtom = atom(false);

/**
 * Why the newest start of a room's call in this tab did not start it: `busy` while another tab
 * of this session is in a call (it shares this device), `failed` when the call could not start.
 * The room's call panel says so until the next start or until it closes.
 */
export type CallStartProblem = { roomId: string; result: Exclude<StartCallResult, 'started'> };

export const callStartProblemAtom = atom<CallStartProblem | undefined>(undefined);

const IDLE_STATE: CallState = {
  phase: 'ended',
  microphone: false,
  camera: false,
  screenShare: false,
  sound: true,
  audioBlocked: false,
  devices: {},
  participants: [],
};
const noSubscription = () => () => undefined;
const idleState = () => IDLE_STATE;

/** A call's current state, re-rendering on each change. */
export const useCallState = (call: RoomCall | undefined): CallState =>
  useSyncExternalStore(call?.subscribe ?? noSubscription, call?.getState ?? idleState);

/** The room the call panel is shown in for this call. */
export const callHomeRoomId = (active: ActiveCall): string =>
  active.origin?.roomId ?? active.call.room.roomId;

/** Whether the room's call panel shows the active call (its own, or an agent call started there). */
export const isActiveCallShownIn = (active: ActiveCall | undefined, roomId: string): boolean =>
  !!active && (active.call.room.roomId === roomId || active.origin?.roomId === roomId);

export const useCallPanel = (roomId: string) => {
  const panelRoomId = useAtomValue(callPanelRoomAtom);
  const setPanelRoomId = useSetAtom(callPanelRoomAtom);
  const open = panelRoomId === roomId;
  const setOpen = useCallback(
    (next: boolean) =>
      setPanelRoomId((current) => (next ? roomId : current === roomId ? undefined : current)),
    [roomId, setPanelRoomId]
  );
  return [open, setOpen] as const;
};

/** The devices in a room's call, oldest first, following membership changes. */
export const useRoomCallMembers = (mx: MatrixClient, room: Room): CallMember[] => {
  const [members, setMembers] = useState<CallMember[]>(() =>
    activeMemberships(mx.matrixRTC.getRoomSession(room))
  );
  useEffect(() => {
    const session = mx.matrixRTC.getRoomSession(room);
    const read = () => setMembers(activeMemberships(session));
    read();
    session.on(MatrixRTCSessionEvent.MembershipsChanged, read);
    // Memberships of people whose room member event is not loaded yet are left out until it is.
    room.on(RoomStateEvent.Members, read);
    return () => {
      session.off(MatrixRTCSessionEvent.MembershipsChanged, read);
      room.off(RoomStateEvent.Members, read);
    };
  }, [mx, room]);
  return members;
};

export type StartCallOptions = {
  room: Room;
  video?: boolean;
  microphone?: boolean;
  devices?: CallDevices;
  notify?: 'ring' | 'notification';
  /**
   * Runs once nothing else stands in the call's way (no other call here or in another tab), right
   * before the call is made, such as writing an agent call room's origin. A start that gives up
   * after it ran calls `onEnded`, as a call that ended would.
   */
  prepare?: () => Promise<void>;
} & Omit<ActiveCall, 'call'>;

/**
 * `busy`: another call runs. `failed`: the call could not start, or its account signed out or
 * switched while it was starting.
 */
export type StartCallResult = 'started' | 'busy' | 'failed';

/** The newest event's server time in a room's loaded live timeline. */
const newestEventTs = (room: Room): number | undefined =>
  room.getLiveTimeline().getEvents().at(-1)?.getTs();

/**
 * Starting and ending the call. Starting while another call is active or starting, in this tab or
 * another tab of the same session, does nothing and answers `busy`. The call engine and LiveKit
 * load on first use.
 */
export const useCallActions = (mx: MatrixClient) => {
  const store = useStore();

  const endCall = useCallback(async () => {
    const active = store.get(activeCallAtom);
    if (!active) return;
    // A leave that fails still ends the call here, or every later start would answer `busy`.
    try {
      await active.call.leave();
    } finally {
      await active.onEnded?.().catch(() => undefined);
      if (store.get(activeCallAtom) === active) store.set(activeCallAtom, undefined);
    }
  }, [store]);

  /** Makes the call and makes it the active one, or answers why it cannot start. */
  const makeCall = useCallback(
    async ({
      room,
      video,
      microphone,
      devices,
      notify,
      prepare,
      ...meta
    }: StartCallOptions): Promise<RoomCall | Exclude<StartCallResult, 'started'>> => {
      // The engine is a chunk of its own; after a deploy the server may no longer have the one
      // this page asks for.
      const engine = await import('./RoomCall').catch(() => undefined);
      if (!engine) return 'failed';
      // Another tab of this session shares the device: joining here would withdraw and replace
      // that tab's membership, and the two would keep replacing each other. The check and the
      // lock are one step, so two tabs that start at the same moment cannot both get through.
      const releaseDeviceLock = await takeDeviceCallLock(mx);
      if (!releaseDeviceLock) return 'busy';
      let prepared = false;
      const giveUp = (result: Exclude<StartCallResult, 'started'>) => {
        releaseDeviceLock();
        if (prepared) meta.onEnded?.().catch(() => undefined);
        return result;
      };
      // The store is app-wide: a call whose account went away while this waited would become
      // the next account's call.
      if (!mx.clientRunning) return giveUp('failed');
      if (prepare) {
        prepared = true;
        try {
          await prepare();
        } catch {
          return giveUp('failed');
        }
      }
      await room.loadMembersIfNeeded().catch(() => undefined);
      if (!mx.clientRunning) return giveUp('failed');
      const call = new engine.RoomCall({
        mx,
        room,
        video,
        microphone,
        devices,
        notify,
        releaseDeviceLock,
      });
      const active: ActiveCall = {
        ...meta,
        call,
        startedAfterTs: meta.startedAfterTs ?? newestEventTs(room),
      };
      store.set(activeCallAtom, active);
      store.set(callPanelRoomAtom, callHomeRoomId(active));
      return call;
    },
    [mx, store]
  );

  const startCall = useCallback(
    async (options: StartCallOptions): Promise<StartCallResult> => {
      if (store.get(activeCallAtom) || store.get(callStartingAtom)) return 'busy';
      store.set(callStartingAtom, true);
      let made: Awaited<ReturnType<typeof makeCall>>;
      try {
        made = await makeCall(options);
      } finally {
        store.set(callStartingAtom, false);
      }
      if (typeof made === 'string') return made;
      const call = made;
      // A join that breaks outside its own checks still ends as a failed call with Dismiss.
      await call.join().catch(() => call.fail('service'));
      return 'started';
    },
    [makeCall, store]
  );

  /** Closes a call that failed to start, so another can begin. */
  const dismissCall = useCallback(() => {
    const active = store.get(activeCallAtom);
    if (!active) return;
    active.call.leave().catch(() => undefined);
    active.onEnded?.().catch(() => undefined);
    store.set(activeCallAtom, undefined);
  }, [store]);

  return { startCall, endCall, dismissCall };
};
