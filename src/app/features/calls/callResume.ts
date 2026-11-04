import {
  ClientEvent,
  EventTimeline,
  KnownMembership,
  SyncState,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { StateEvent } from '../../../types/matrix/room';
import {
  getStorageItemSafe,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../../utils/safeLocalStorage';
import type { CallDevices } from './RoomCall';
import type { ActiveCall, CallOrigin } from './callStore';
import { matchesEnum } from '../../utils/matchesEnum';

/**
 * A call this tab was in when its page went away, kept in the tab's session storage so the page
 * that loads next (a reload) can take the call up again.
 */
export type CallResumeRecord = {
  userId: string;
  deviceId: string;
  roomId: string;
  kind: ActiveCall['kind'];
  agentUserId?: string;
  origin?: CallOrigin;
  microphone: boolean;
  camera: boolean;
  devices: CallDevices;
  /** When the page went away. */
  savedAt: number;
};

const RECORD_KEY = 'mindroom.call.resume';
/** A page that comes back later than this (a tab restored long after) starts without the call. */
export const RESUME_WINDOW_MS = 2 * 60_000;

const CALL_MEMBER = StateEvent.GroupCallMemberPrefix as string;

const sessionStore = (): Storage | undefined => {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
};

/** Remembers the active call as the page goes away, unless it already ended. */
export const rememberCallForResume = (mx: MatrixClient, active: ActiveCall, now = Date.now()) => {
  const deviceId = mx.getDeviceId();
  const state = active.call.getState();
  if (!deviceId || state.phase === 'ended' || state.phase === 'failed') return;
  const record: CallResumeRecord = {
    userId: mx.getSafeUserId(),
    deviceId,
    roomId: active.call.room.roomId,
    kind: active.kind,
    agentUserId: active.agentUserId,
    origin: active.origin,
    microphone: state.microphone,
    camera: state.camera,
    devices: state.devices,
    savedAt: now,
  };
  setStorageItemSafe(sessionStore(), RECORD_KEY, JSON.stringify(record));
};

/** Drops the remembered call, such as when the page comes back from the back/forward cache. */
export const forgetCallResume = () => removeStorageItemSafe(sessionStore(), RECORD_KEY);

const isRecord = (value: unknown): value is CallResumeRecord => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.userId === 'string' &&
    typeof record.deviceId === 'string' &&
    typeof record.roomId === 'string' &&
    (record.kind === 'room' || record.kind === 'agent') &&
    typeof record.savedAt === 'number'
  );
};

/** When this page started loading; a reload starts it shortly before the old page goes away. */
const pageStartedAt = (): number =>
  typeof performance !== 'undefined' && performance.timeOrigin > 0
    ? performance.timeOrigin
    : Date.now();

/**
 * The call to take up again, read once: it belongs to this account and device, and the page
 * before this one went away just as this one started. Reading it removes it, so a resume that
 * fails is not tried again.
 */
export const takeCallResume = (
  mx: MatrixClient,
  startedAt = pageStartedAt()
): CallResumeRecord | undefined => {
  const store = sessionStore();
  const raw = getStorageItemSafe(store, RECORD_KEY);
  if (raw === null) return undefined;
  removeStorageItemSafe(store, RECORD_KEY);
  let record: unknown;
  try {
    record = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(record)) return undefined;
  if (record.userId !== mx.getUserId() || record.deviceId !== mx.getDeviceId()) return undefined;
  if (startedAt - record.savedAt > RESUME_WINDOW_MS) return undefined;
  return record;
};

/**
 * The name of the Web Lock a tab holds while this device is in a call, so another tab of the
 * same session (which shares the device) can tell its membership is not left over.
 */
const deviceCallLock = (userId: string, deviceId: string) => `mindroom-call:${userId}:${deviceId}`;

const lockManager = (): LockManager | undefined =>
  typeof navigator === 'undefined' ? undefined : navigator.locks;

/**
 * How many requests for each call lock this tab made that the browser has not let go of yet. A
 * call that just ended can still hold its lock while the next one starts, and that is no other
 * tab's call.
 */
const requestsHere = new Map<string, number>();

const countRequestHere = (name: string, change: 1 | -1) => {
  const count = (requestsHere.get(name) ?? 0) + change;
  if (count > 0) requestsHere.set(name, count);
  else requestsHere.delete(name);
};

/** Holds this device's call lock until the returned function runs. */
export const holdDeviceCallLock = (mx: MatrixClient): (() => void) => {
  const locks = lockManager();
  const deviceId = mx.getDeviceId();
  if (!locks || !deviceId) return () => undefined;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const name = deviceCallLock(mx.getSafeUserId(), deviceId);
  countRequestHere(name, 1);
  locks
    .request(name, () => held)
    .catch(() => undefined)
    .finally(() => countRequestHere(name, -1));
  return release;
};

/**
 * Whether another tab of this session, which shares the device and so its call memberships, is
 * in a call (or waiting for the lock to join one).
 */
export const deviceInCallElsewhere = async (mx: MatrixClient): Promise<boolean> => {
  const locks = lockManager();
  const deviceId = mx.getDeviceId();
  if (!locks || !deviceId) return false;
  const name = deviceCallLock(mx.getSafeUserId(), deviceId);
  const { held = [], pending = [] } = await locks.query().catch(() => ({} as LockManagerSnapshot));
  const requests = [...held, ...pending].filter((lock) => lock.name === name).length;
  return requests > (requestsHere.get(name) ?? 0);
};

/** Withdraws this device's call memberships in the given rooms (MSC4143: empty content). */
export const withdrawOwnMemberships = async (mx: MatrixClient, rooms: Room[]): Promise<void> => {
  const userId = mx.getSafeUserId();
  const deviceId = mx.getDeviceId();
  if (!deviceId) return;
  const withdrawals = rooms.flatMap((room) => {
    const state = room.getLiveTimeline().getState(EventTimeline.FORWARDS);
    return (state?.getStateEvents(CALL_MEMBER) ?? [])
      .filter((event) => event.getSender() === userId)
      .filter((event) => event.getContent().device_id === deviceId)
      .map((event) =>
        mx.sendStateEvent(room.roomId, CALL_MEMBER as never, {} as never, event.getStateKey())
      );
  });
  await Promise.allSettled(withdrawals);
};

/**
 * Withdraws the call memberships this device left behind (a tab that crashed, or closed before
 * its leave reached the server), so nobody waits for it and an agent does not stay in an empty
 * call until the membership expires. Skipped while another tab of this device is in a call.
 */
export const withdrawLeftoverMemberships = async (
  mx: MatrixClient,
  keepRoomId?: string
): Promise<void> => {
  if (!mx.getDeviceId() || (await deviceInCallElsewhere(mx))) return;
  const rooms = mx
    .getRooms()
    .filter((room) => room.roomId !== keepRoomId)
    .filter((room) => matchesEnum(room.getMyMembership(), KnownMembership.Join));
  await withdrawOwnMemberships(mx, rooms);
};

/**
 * Resolves after the client applied a sync from the server. Rooms restored from the cache can
 * miss what happened since it was saved, such as a membership a crashed tab left behind.
 */
export const whenServerSynced = (mx: MatrixClient): Promise<void> =>
  new Promise((resolve) => {
    // The SDK reports SYNCING after each sync from the server; a cached start reports PREPARED.
    if (mx.getSyncState() === SyncState.Syncing) {
      resolve();
      return;
    }
    const onSync = (state: SyncState) => {
      if (state !== SyncState.Syncing) return;
      mx.off(ClientEvent.Sync, onSync);
      resolve();
    };
    mx.on(ClientEvent.Sync, onSync);
  });
