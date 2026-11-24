import {
  ClientEvent,
  MatrixClient,
  Room,
  RoomMember,
  RoomMemberEvent,
  SyncState,
} from 'matrix-js-sdk';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api';
import type { ReceivedToDeviceMessage } from 'matrix-js-sdk/lib/sync-accumulator';
import { randomUuid } from '../lib/randomUuid';
import { isMindroomAgentUserIdForViewer } from '../matrix/protocol/agentIdentity';
import {
  isCurrentModelRuntime,
  joinedModelCandidates,
  ModelRuntime,
  signedModelDevices,
} from '../matrix/runtimeDeviceTrust';
import { sendEncryptedToDeviceRequest } from '../matrix/runtimeToDeviceTransport';
import {
  hasLowQuotaInSnapshot,
  parseProviderUsageResponse,
  ProviderUsageSnapshot,
  USAGE_REQUEST,
  USAGE_RESPONSE,
  USAGE_TIMEOUT,
} from './providerUsageProtocol';

export type ProviderUsageRuntime = ModelRuntime;
export type ProviderUsageStatus = 'idle' | 'loading' | 'ready' | 'unavailable';
export type ProviderUsageState = {
  status: ProviderUsageStatus;
  available: boolean;
  hasLowQuota: boolean;
  loading: boolean;
  refreshing: boolean;
  runtimes: readonly ProviderUsageRuntime[];
  selectedRuntimeId: string | undefined;
  snapshot: ProviderUsageSnapshot | undefined;
  snapshotsByRuntime: Readonly<Record<string, ProviderUsageSnapshot>>;
};
export type RuntimeIdentity =
  | { id?: string; userId: string; deviceId: string; curveKey: string }
  | string;

type ProbeRun = {
  kind: 'startup' | 'full' | 'room';
  roomId?: string;
  refreshing: boolean;
  abort: AbortController;
  timer?: ReturnType<typeof setTimeout>;
};
type ActiveQuery = { run: ProbeRun; roomId: string; devices: ModelRuntime[]; answered: boolean };
type RuntimeEntry = { runtime: ProviderUsageRuntime; snapshot: ProviderUsageSnapshot };

const MAX_PROBE_PLANS = 16;
const MAX_ROOMS_TO_SCAN = 200;
const HYDRATE_CONCURRENCY = 4;
const BATCH_SIZE = 64;
const INITIAL_STATE: ProviderUsageState = Object.freeze({
  status: 'idle',
  available: false,
  hasLowQuota: false,
  loading: false,
  refreshing: false,
  runtimes: Object.freeze([]),
  selectedRuntimeId: undefined,
  snapshot: undefined,
  snapshotsByRuntime: Object.freeze({}),
});

const runtimeKeyOf = (d: Pick<ModelRuntime, 'userId' | 'deviceId'>): string =>
  `${d.userId}:${d.deviceId}`;
const hasLoadedMembers = (room: Room): boolean => !room.membersLoaded || room.membersLoaded();
const isJoinedRoom = (room: Room, userId: string | null): boolean =>
  room.getMyMembership
    ? room.getMyMembership() === 'join'
    : !userId || room.getMember(userId)?.membership === 'join';

const signedDevicesByUser = async (mx: MatrixClient, users: string[]) => {
  const byUser = new Map<string, ModelRuntime[]>();
  try {
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      for (const d of await signedModelDevices(mx, users.slice(i, i + BATCH_SIZE))) {
        byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d]);
      }
    }
  } catch {
    byUser.clear();
  }
  return byUser;
};

/** Strictly look up the snapshot for a specific authenticated runtime identity; never falls back. */
export const snapshotForRuntime = (
  state: Pick<ProviderUsageState, 'runtimes' | 'snapshotsByRuntime'>,
  runtime: RuntimeIdentity | undefined
): ProviderUsageSnapshot | undefined => {
  if (!runtime) return undefined;
  if (typeof runtime === 'string' && state.snapshotsByRuntime[runtime]) {
    return state.snapshotsByRuntime[runtime];
  }
  const hit = state.runtimes.find((r) =>
    typeof runtime === 'string'
      ? JSON.stringify([r.userId, r.deviceId, r.curveKey]) === runtime
      : r.userId === runtime.userId &&
        r.deviceId === runtime.deviceId &&
        r.curveKey === runtime.curveKey
  );
  return hit ? state.snapshotsByRuntime[hit.id] : undefined;
};

const controllers = new WeakMap<MatrixClient, ProviderUsageController>();

export class ProviderUsageController {
  private readonly userId: string | null;
  private owners = 0;
  private phase: 'idle' | 'active' | 'disposed' = 'idle';
  private discovery: 'idle' | 'partial' | 'full' = 'idle';
  private probedDevices = false;
  private startupScheduled = false;
  private lastAnsweringRoomId?: string;
  private selectedRuntimeId?: string;
  private readonly probedRooms = new Set<string>();
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private readonly runs = new Set<ProbeRun>();
  private readonly queries = new Map<string, ActiveQuery>();
  private readonly listeners = new Set<() => void>();
  private state: ProviderUsageState = INITIAL_STATE;

  constructor(private readonly mx: MatrixClient) {
    this.userId = mx.getUserId?.() ?? null;
  }

  retain = (): (() => void) => {
    this.owners += 1;
    this.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if ((this.owners -= 1) === 0) this.dispose();
    };
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.phase === 'idle') this.start();
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ProviderUsageState => this.state;

  selectRuntime = (runtimeId: string): void => {
    if (!this.runtimes.has(runtimeId) || this.selectedRuntimeId === runtimeId) return;
    this.selectedRuntimeId = runtimeId;
    this.publish();
  };

  /** With `roomId`, runs a room-scoped probe; without it, completes one hydrated full discovery. */
  ensureLoaded = (roomId?: string): void => {
    if (!this.active()) return;
    if (roomId) {
      const busy =
        this.probedRooms.has(roomId) ||
        [...this.runs].some((r) => r.roomId === roomId) ||
        [...this.queries.values()].some((q) => q.roomId === roomId);
      const room = !busy ? this.mx.getRoom?.(roomId) : null;
      if (room && isJoinedRoom(room, this.userId)) void this.probe('room', [room]);
      return;
    }
    if (this.discovery === 'full' || [...this.runs].some((r) => r.kind === 'full')) return;
    this.stopRuns((r) => r.kind === 'startup');
    void this.probe('full', this.orderedJoinedRooms());
  };

  refresh = (force = false): void => {
    if (!this.active()) return;
    this.stopRuns();
    this.probedRooms.clear();
    if (this.discovery === 'full') this.discovery = 'partial';
    void this.probe('full', this.orderedJoinedRooms(), force);
  };

  private sameUser = () => !this.mx.getUserId || this.mx.getUserId() === this.userId;
  private active = () => this.phase === 'active' && this.sameUser();
  private isLive = (run: ProbeRun) => this.active() && this.runs.has(run);
  private canAutoProbe = () =>
    this.active() && !this.probedDevices && !this.runs.size && !this.runtimes.size;

  private bindEvents(bind: boolean): void {
    const fn = (bind ? this.mx.on : this.mx.removeListener)?.bind(this.mx) as
      | typeof this.mx.on
      | undefined;
    if (!fn) return;
    fn(ClientEvent.ReceivedToDeviceMessage, this.onResponse);
    fn(ClientEvent.Sync, this.onSync);
    fn(CryptoEvent.DevicesUpdated, this.onDevices);
    fn(RoomMemberEvent.Membership, this.onMembership);
  }

  private start(): void {
    const sync = this.mx.getSyncState?.();
    if (this.phase === 'active' || !this.mx.on || sync === SyncState.Stopped || !this.sameUser())
      return;
    this.phase = 'active';
    this.bindEvents(true);
    if (sync) this.onSync(sync);
  }

  private stopRuns(match?: (run: ProbeRun) => boolean, publish = false): void {
    let stopped = false;
    for (const run of this.runs) {
      if (match && !match(run)) continue;
      stopped = true;
      this.runs.delete(run);
      clearTimeout(run.timer);
      run.abort.abort();
      for (const [id, q] of this.queries) if (q.run === run) this.queries.delete(id);
    }
    if (stopped && publish && this.active()) this.publish();
  }

  private orderedJoinedRooms(preferred?: string): Room[] {
    const joined = (this.mx.getRooms?.() ?? []).filter((r) => isJoinedRoom(r, this.userId));
    const rank = (r: Room) =>
      r.roomId === preferred ? 0 : r.roomId === this.lastAnsweringRoomId ? 1 : 2;
    return joined.sort((a, b) => rank(a) - rank(b)).slice(0, MAX_ROOMS_TO_SCAN);
  }

  private async probe(kind: ProbeRun['kind'], rooms: readonly Room[], force?: boolean) {
    const run: ProbeRun = {
      kind,
      roomId: kind === 'room' ? rooms[0]?.roomId : undefined,
      refreshing: force !== undefined && this.runtimes.size > 0,
      abort: new AbortController(),
    };
    this.runs.add(run);
    this.publish();
    const finish = () => this.stopRuns((r) => r === run, true);

    const cohorts = new Map<string, { room: Room; users: string[] }>();
    let sawUnloaded = false;
    for (let i = 0; i < rooms.length && cohorts.size < MAX_PROBE_PLANS; i += HYDRATE_CONCURRENCY) {
      const batch = rooms.slice(i, i + HYDRATE_CONCURRENCY);
      if (kind !== 'startup') {
        const unloaded = batch.filter((r) => !hasLoadedMembers(r) && r.loadMembersIfNeeded);
        if (unloaded.length) {
          await Promise.allSettled(unloaded.map((r) => r.loadMembersIfNeeded()));
          if (!this.isLive(run)) return;
        }
      }
      for (const room of batch) {
        const loaded = hasLoadedMembers(room);
        if (!loaded) sawUnloaded = true;
        const users = joinedModelCandidates(this.mx, room);
        if (!users.length) {
          if (loaded) this.probedRooms.add(room.roomId);
          continue;
        }
        const key = [...users].sort().join('\0');
        if (!cohorts.has(key)) cohorts.set(key, { room, users });
        if (cohorts.size >= MAX_PROBE_PLANS) break;
      }
    }

    const uniqueUsers = [...new Set([...cohorts.values()].flatMap((c) => c.users))];
    if (!uniqueUsers.length) {
      if (kind === 'full' && rooms.length) this.discovery = 'full';
      return finish();
    }
    const byUser = await signedDevicesByUser(this.mx, uniqueUsers);
    if (!this.isLive(run)) return;
    if (byUser.size && (kind === 'full' || (kind === 'startup' && !sawUnloaded))) {
      this.discovery = 'full';
    }

    let dispatched = false;
    for (const { room, users } of cohorts.values()) {
      const devices = users.flatMap((u) => byUser.get(u) ?? []);
      if (!devices.length) continue;
      if (hasLoadedMembers(room)) this.probedRooms.add(room.roomId);
      if (!run.refreshing && devices.every((d) => this.runtimes.has(runtimeKeyOf(d)))) continue;
      if (!dispatched) {
        dispatched = true;
        this.probedDevices = true;
        if (this.discovery === 'idle') this.discovery = 'partial';
        run.timer = setTimeout(finish, USAGE_TIMEOUT);
      }
      const requestId = randomUuid();
      const query: ActiveQuery = { run, roomId: room.roomId, devices, answered: false };
      this.queries.set(requestId, query);
      void sendEncryptedToDeviceRequest(
        this.mx,
        USAGE_REQUEST,
        devices,
        { version: 1, request_id: requestId, room_id: room.roomId, force_refresh: Boolean(force) },
        run.abort.signal,
        () => query.answered
      );
    }
    if (!dispatched) finish();
  }

  private onResponse = ({ message, encryptionInfo }: ReceivedToDeviceMessage): void => {
    if (
      !this.active() ||
      message.type !== USAGE_RESPONSE ||
      !encryptionInfo ||
      encryptionInfo.sender !== message.sender
    )
      return;
    const snapshot = parseProviderUsageResponse(message.content);
    const query = snapshot && this.queries.get(snapshot.request_id);
    const device = query?.devices.find(
      (d) => d.userId === message.sender && d.curveKey === encryptionInfo.senderCurve25519KeyBase64
    );
    if (!snapshot || !query || !device) return;
    void isCurrentModelRuntime(this.mx, device)
      .then((ok) => {
        if (!ok || !this.isLive(query.run)) return;
        const runtimeId = runtimeKeyOf(device);
        query.answered = true;
        this.lastAnsweringRoomId = query.roomId;
        this.runtimes.set(runtimeId, { runtime: { ...device, id: runtimeId }, snapshot });
        this.selectedRuntimeId ??= runtimeId;
        if (query.run.refreshing && this.selectedRuntimeId === runtimeId)
          query.run.refreshing = false;
        this.publish();
      })
      .catch(() => undefined);
  };

  private onSync = (state: SyncState): void => {
    if (state === SyncState.Stopped) return this.dispose();
    if (state !== SyncState.Prepared && state !== SyncState.Syncing) return;
    if (this.startupScheduled || !this.active()) return;
    this.startupScheduled = true;
    void Promise.resolve().then(() => {
      if (this.canAutoProbe()) void this.probe('startup', this.orderedJoinedRooms());
    });
  };

  private onDevices = (users: string[]): void => {
    if (!this.canAutoProbe()) return;
    const updated = new Set(users);
    const rooms = this.orderedJoinedRooms();
    if (rooms.some((r) => joinedModelCandidates(this.mx, r).some((id) => updated.has(id)))) {
      void this.probe('startup', rooms);
    }
  };

  private onMembership = (_event: unknown, member: RoomMember): void => {
    if (
      member.membership !== 'join' ||
      !this.active() ||
      !this.userId ||
      member.userId === this.userId ||
      !isMindroomAgentUserIdForViewer(member.userId, this.userId)
    )
      return;
    const room = this.mx.getRoom?.(member.roomId);
    if (!room || !isJoinedRoom(room, this.userId)) return;
    this.probedRooms.delete(room.roomId);
    if (this.discovery === 'full') this.discovery = this.probedDevices ? 'partial' : 'idle';
    if (this.canAutoProbe()) void this.probe('startup', this.orderedJoinedRooms(room.roomId));
  };

  private publish(): void {
    const entries = [...this.runtimes.values()];
    if (!entries.length) {
      const loading = [...this.runs].some((r) => r.kind !== 'startup');
      const status: ProviderUsageStatus = loading
        ? 'loading'
        : this.discovery === 'idle'
        ? 'idle'
        : 'unavailable';
      this.state = { ...INITIAL_STATE, status, loading };
    } else {
      this.state = {
        status: 'ready',
        available: true,
        hasLowQuota: entries.some((e) => hasLowQuotaInSnapshot(e.snapshot)),
        loading: false,
        refreshing: [...this.runs].some((r) => r.refreshing),
        runtimes: entries.map((e) => e.runtime),
        selectedRuntimeId: this.selectedRuntimeId,
        snapshot: this.runtimes.get(this.selectedRuntimeId ?? '')?.snapshot,
        snapshotsByRuntime: Object.fromEntries(entries.map((e) => [e.runtime.id, e.snapshot])),
      };
    }
    this.listeners.forEach((fn) => fn());
  }

  dispose = (): void => {
    if (this.phase === 'disposed') return;
    this.phase = 'disposed';
    this.startupScheduled = false;
    this.stopRuns();
    this.bindEvents(false);
  };
}

export const getProviderUsageController = (mx: MatrixClient): ProviderUsageController => {
  let controller = controllers.get(mx);
  if (!controller) controllers.set(mx, (controller = new ProviderUsageController(mx)));
  return controller;
};

export const disposeProviderUsageController = (mx: MatrixClient): void =>
  controllers.get(mx)?.dispose();
