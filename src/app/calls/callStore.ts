import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { atom, useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { KnownMembership, RoomStateEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { MatrixRTCSessionEvent } from 'matrix-js-sdk/lib/matrixrtc';
import type { CallDevices, CallPhase, CallState, RoomCall } from './RoomCall';
import { activeMemberships, type CallMember } from './callMemberships';
import { takeDeviceCallLock } from './callResume';
import { requestOwnSfuGrant } from './rtcFocus';

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

/** The start running in this tab, if any; a second start would race it for the one call. */
const callStartingAtom = atom<object | undefined>(undefined);

/**
 * Why the newest start of a room's call in this tab did not start it: `busy` while another tab
 * of this session is in a call (it shares this device), `failed` when the call could not start.
 * The room's call panel says so until the next start or until it closes.
 */
export type CallStartProblem = { roomId: string; result: Exclude<StartCallResult, 'started'> };

export const callStartProblemAtom = atom<CallStartProblem | undefined>(undefined);

/** What a room's call prescreen joins with: the microphone, the camera and the devices picked. */
export type PrescreenChoices = { microphone: boolean; camera: boolean; devices: CallDevices };

/**
 * What the person picked in a room's call view: the prescreen's choices, and for the call it
 * shows speaker view or the grid (`speaker`) and the pick for the screens shared then (`screens`,
 * for its `pickScope`).
 */
export type CallViewState = {
  prescreen?: PrescreenChoices;
  speaker?: boolean;
  screens?: { scope: string; speaker: boolean };
};

/**
 * Each room's call view state. The view mounts anew wherever it moves (the floating window, the
 * docked panel, a phone's panel) and when it opens again, so what was picked in it lives here,
 * with the call: until a call starts in the room or the call it shows ends, and with the account.
 */
export const callViewStateAtom = atom<ReadonlyMap<string, CallViewState>>(new Map());

const NOTHING_PICKED: CallViewState = {};

/** A room's call view state, and a way to change it. */
export const useCallViewState = (roomId: string) => {
  const [views, setViews] = useAtom(callViewStateAtom);
  const change = useCallback(
    (next: (last: CallViewState) => CallViewState) =>
      setViews((last) => new Map(last).set(roomId, next(last.get(roomId) ?? NOTHING_PICKED))),
    [roomId, setViews]
  );
  return [views.get(roomId) ?? NOTHING_PICKED, change] as const;
};

type Store = ReturnType<typeof useStore>;

/** Forgets what a room's call view kept: a call starts there, or the call it shows ended. */
const forgetCallView = (store: Store, roomId: string): void => {
  const views = new Map(store.get(callViewStateAtom));
  if (views.delete(roomId)) store.set(callViewStateAtom, views);
};

/** Leaves the call without waiting for the server, then runs what follows its end. */
export const leaveCallNow = (active: ActiveCall): void => {
  active.call.leave().catch(() => undefined);
  active.onEnded?.().catch(() => undefined);
};

/** The room the call panel is shown in for this call. */
export const callHomeRoomId = (active: ActiveCall): string =>
  active.origin?.roomId ?? active.call.room.roomId;

/**
 * Closes the panel an agent call had in its conversation once that call is over: the panel would
 * go on to that room's own call ("be the first to hop in"), which is not the call that just ended.
 * A room call's panel stays, on the call to join again.
 */
const closeAgentCallPanel = (store: Store, ended: ActiveCall): void => {
  if (ended.kind === 'agent' && store.get(callPanelRoomAtom) === callHomeRoomId(ended)) {
    store.set(callPanelRoomAtom, undefined);
  }
};

/** Forgets the call that is over here, and what its view kept. */
const forgetEndedCall = (store: Store, ended: ActiveCall): void => {
  store.set(activeCallAtom, undefined);
  forgetCallView(store, callHomeRoomId(ended));
  closeAgentCallPanel(store, ended);
};

/** Leaves the active call without waiting and forgets it, so the next start finds none. */
export const dropActiveCall = (store: Store): void => {
  const active = store.get(activeCallAtom);
  if (!active) return;
  leaveCallNow(active);
  forgetEndedCall(store, active);
};

/**
 * What an account leaves in the call state when its screens go: its call (left), the open call
 * panel and what was picked in call views, a start still running (which gives up, its client
 * being stopped) and why the last start failed. The next account would otherwise find them in a
 * room both accounts are in.
 */
export const forgetCallState = (store: Store): void => {
  dropActiveCall(store);
  store.set(callPanelRoomAtom, undefined);
  store.set(callViewStateAtom, new Map());
  store.set(callStartingAtom, undefined);
  store.set(callStartProblemAtom, undefined);
};

/**
 * Keeps why the newest start of a room's call did not start it, for the room's call panel (a
 * start that did clears it), and answers whether there was a problem to show. A start whose
 * account signed out or switched meanwhile notes nothing: the store is app-wide, and the next
 * account's panel would show the problem as its own.
 */
export const noteCallStart = (
  store: Store,
  mx: MatrixClient,
  roomId: string,
  result: StartCallResult
): boolean => {
  if (!mx.clientRunning) return false;
  store.set(callStartProblemAtom, result === 'started' ? undefined : { roomId, result });
  return result !== 'started';
};

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

const LIVE_PHASES: ReadonlySet<CallPhase> = new Set(['connecting', 'connected', 'reconnecting']);

/**
 * Whether this device is in a call now: starting, connected or reconnecting (not one that failed
 * and waits to be closed). Re-renders only when that answer changes, not on every call update.
 */
export const useInCall = (): boolean => {
  const call = useActiveCall()?.call;
  return useSyncExternalStore(
    call?.subscribe ?? noSubscription,
    () => !!call && LIVE_PHASES.has(call.getState().phase)
  );
};

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
      if (store.get(activeCallAtom) === active) forgetEndedCall(store, active);
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
      // The engine is a chunk of its own, loaded while the call is prepared; after a deploy the
      // server may no longer have the one this page asks for.
      const loading = import('./RoomCall').catch(() => undefined);
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
      // The call service's grant is asked for meanwhile too, so the join need not wait for it.
      const grant = requestOwnSfuGrant(mx, room.roomId).catch(() => undefined);
      if (prepare) {
        prepared = true;
        try {
          await prepare();
        } catch {
          return giveUp('failed');
        }
      }
      await room.loadMembersIfNeeded().catch(() => undefined);
      const engine = await loading;
      if (!engine || !mx.clientRunning) return giveUp('failed');
      // A room the person left meanwhile (the call's, or the conversation an agent call is about)
      // has no call view to show the call in; from here on, its call ends with it (`CallWindowHost`).
      const left = [room.roomId, meta.origin?.roomId].some(
        (roomId) => roomId && mx.getRoom(roomId)?.getMyMembership() !== KnownMembership.Join
      );
      if (left) return giveUp('failed');
      const call = new engine.RoomCall({
        mx,
        room,
        video,
        microphone,
        devices,
        notify,
        releaseDeviceLock,
        grant,
      });
      const active: ActiveCall = {
        ...meta,
        call,
        startedAfterTs: meta.startedAfterTs ?? newestEventTs(room),
      };
      // The prescreen's choices went into the call, whose own picks start afresh.
      forgetCallView(store, callHomeRoomId(active));
      store.set(activeCallAtom, active);
      store.set(callPanelRoomAtom, callHomeRoomId(active));
      return call;
    },
    [mx, store]
  );

  const startCall = useCallback(
    async (options: StartCallOptions): Promise<StartCallResult> => {
      if (store.get(activeCallAtom) || store.get(callStartingAtom)) return 'busy';
      const start = {};
      store.set(callStartingAtom, start);
      let made: Awaited<ReturnType<typeof makeCall>>;
      try {
        made = await makeCall(options);
      } finally {
        // A start its account left behind ends only itself, not a start of the next account.
        if (store.get(callStartingAtom) === start) store.set(callStartingAtom, undefined);
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
  const dismissCall = useCallback(() => dropActiveCall(store), [store]);

  return { startCall, endCall, dismissCall };
};
