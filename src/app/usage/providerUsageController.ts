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
const isSyncReady = (s: SyncState | null | undefined): boolean =>
  s === SyncState.Prepared || s === SyncState.Syncing;
const hasLoadedMembers = (room: Room): boolean =>
  typeof room.membersLoaded !== 'function' || room.membersLoaded();
const cohortKey = (users: readonly string[]): string => [...users].sort().join('\0');

const signedDevicesByUser = async (
  mx: MatrixClient,
  uniqueUsers: readonly string[]
): Promise<Map<string, ModelRuntime[]>> => {
  const byUser = new Map<string, ModelRuntime[]>();
  try {
    for (let i = 0; i < uniqueUsers.length; i += BATCH_SIZE) {
      for (const d of await signedModelDevices(mx, uniqueUsers.slice(i, i + BATCH_SIZE))) {
        const list = byUser.get(d.userId);
        if (list) list.push(d);
        else byUser.set(d.userId, [d]);
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
  private startupScheduled = false;
  private hasProbedWithDevices = false;
  private fullDiscoveryDone = false;
  private lastAnsweringRoomId?: string;
  private selectedRuntimeId?: string;
  private readonly probedRooms = new Set<string>();
  private readonly runtimes = new Map<
    string,
    { runtime: ProviderUsageRuntime; snapshot: ProviderUsageSnapshot }
  >();
  private readonly runs = new Set<ProbeRun>();
  private readonly queries = new Map<string, ActiveQuery>();
  private readonly listeners = new Set<() => void>();
  private state: ProviderUsageState = INITIAL_STATE;

  constructor(private readonly mx: MatrixClient) {
    this.userId = typeof mx.getUserId === 'function' ? mx.getUserId() : null;
  }

  retain = (): (() => void) => {
    this.owners += 1;
    this.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.owners -= 1;
      if (this.owners === 0) this.dispose();
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
      if (
        this.probedRooms.has(roomId) ||
        [...this.runs].some((r) => r.roomId === roomId) ||
        [...this.queries.values()].some((q) => q.roomId === roomId)
      )
        return;
      const room = typeof this.mx.getRoom === 'function' ? this.mx.getRoom(roomId) : null;
      if (room && this.isJoinedRoom(room)) this.runProbe('room', [room], false, false, roomId);
      return;
    }
    if (this.fullDiscoveryDone || [...this.runs].some((r) => r.kind === 'full')) return;
    for (const run of [...this.runs]) if (run.kind === 'startup') this.cancelRun(run);
    this.runProbe('full', this.orderedJoinedRooms(), false, false);
  };

  refresh = (force = false): void => {
    if (!this.active()) return;
    for (const run of [...this.runs]) this.cancelRun(run);
    this.probedRooms.clear();
    this.fullDiscoveryDone = false;
    this.runProbe(
      'full',
      this.orderedJoinedRooms(this.lastAnsweringRoomId),
      force,
      this.runtimes.size > 0
    );
  };

  private start(): void {
    if (
      this.phase === 'active' ||
      typeof this.mx.on !== 'function' ||
      this.mx.getSyncState?.() === SyncState.Stopped ||
      (typeof this.mx.getUserId === 'function' && this.mx.getUserId() !== this.userId)
    )
      return;
    this.phase = 'active';
    this.mx.on(ClientEvent.ReceivedToDeviceMessage, this.onResponse);
    this.mx.on(ClientEvent.Sync, this.onSync);
    this.mx.on(CryptoEvent.DevicesUpdated, this.onDevices);
    this.mx.on(RoomMemberEvent.Membership, this.onMembership);
    if (isSyncReady(this.mx.getSyncState?.())) this.scheduleStartupProbe();
  }

  private active(): boolean {
    return (
      this.phase === 'active' &&
      (typeof this.mx.getUserId !== 'function' || this.mx.getUserId() === this.userId)
    );
  }

  private canAutoProbe(): boolean {
    return (
      this.active() &&
      !this.hasProbedWithDevices &&
      !this.fullDiscoveryDone &&
      this.runs.size === 0 &&
      this.runtimes.size === 0
    );
  }

  private scheduleStartupProbe(): void {
    if (this.startupScheduled || !this.active()) return;
    this.startupScheduled = true;
    void Promise.resolve().then(() => {
      if (this.canAutoProbe()) this.runProbe('startup', this.orderedJoinedRooms(), false, false);
    });
  }

  private cancelRun(run: ProbeRun): void {
    clearTimeout(run.timer);
    run.abort.abort();
    this.runs.delete(run);
    for (const [id, q] of this.queries) if (q.run === run) this.queries.delete(id);
  }

  private finishRun(run: ProbeRun): void {
    if (!this.active() || !this.runs.has(run)) return;
    this.cancelRun(run);
    this.publish();
  }

  private isJoinedRoom(room: Room): boolean {
    return typeof room.getMyMembership === 'function'
      ? room.getMyMembership() === 'join'
      : !this.userId || room.getMember(this.userId)?.membership === 'join';
  }

  private orderedJoinedRooms(preferredRoomId?: string): Room[] {
    const rooms = typeof this.mx.getRooms === 'function' ? this.mx.getRooms() : [];
    const byId = new Map(rooms.filter((r) => this.isJoinedRoom(r)).map((r) => [r.roomId, r]));
    const ordered: Room[] = [];
    for (const id of [preferredRoomId, this.lastAnsweringRoomId]) {
      const room = id ? byId.get(id) : undefined;
      if (room && id) {
        byId.delete(id);
        ordered.push(room);
      }
    }
    for (const room of byId.values()) {
      if (ordered.length >= MAX_ROOMS_TO_SCAN) break;
      ordered.push(room);
    }
    return ordered;
  }

  private runProbe(
    kind: ProbeRun['kind'],
    rooms: readonly Room[],
    forceRefresh: boolean,
    refreshing: boolean,
    roomId?: string
  ): void {
    const run: ProbeRun = { kind, roomId, refreshing, abort: new AbortController() };
    this.runs.add(run);
    this.publish();
    void this.probeRooms(run, rooms, forceRefresh);
  }

  private async probeRooms(
    run: ProbeRun,
    rooms: readonly Room[],
    forceRefresh: boolean
  ): Promise<void> {
    const hydrate = run.kind !== 'startup';
    const seenCohorts = new Set<string>();
    const candidates: Array<{ roomId: string; users: string[]; loaded: boolean }> = [];
    let sawUnloaded = false;

    for (
      let i = 0;
      i < rooms.length && candidates.length < MAX_PROBE_PLANS;
      i += HYDRATE_CONCURRENCY
    ) {
      const batch = rooms.slice(i, i + HYDRATE_CONCURRENCY);
      if (hydrate) {
        const unloaded = batch.filter(
          (r) => !hasLoadedMembers(r) && typeof r.loadMembersIfNeeded === 'function'
        );
        if (unloaded.length > 0) {
          await Promise.allSettled(unloaded.map((r) => r.loadMembersIfNeeded()));
          if (!this.active() || !this.runs.has(run)) return;
        }
      }
      for (const room of batch) {
        const loaded = hasLoadedMembers(room);
        if (!loaded) sawUnloaded = true;
        const users = joinedModelCandidates(this.mx, room);
        if (users.length === 0) {
          if (loaded) this.probedRooms.add(room.roomId);
          continue;
        }
        const cohort = cohortKey(users);
        if (seenCohorts.has(cohort)) continue;
        seenCohorts.add(cohort);
        candidates.push({ roomId: room.roomId, users, loaded });
        if (candidates.length >= MAX_PROBE_PLANS) break;
      }
    }

    if (run.kind === 'full') this.fullDiscoveryDone = true;
    const uniqueUsers = [...new Set(candidates.flatMap((c) => c.users))];
    if (uniqueUsers.length === 0) return this.finishRun(run);

    const byUser = await signedDevicesByUser(this.mx, uniqueUsers);
    if (!this.active() || !this.runs.has(run)) return;

    const plans: Array<{ roomId: string; devices: ModelRuntime[] }> = [];
    for (const { roomId, users, loaded } of candidates) {
      const devices = users.flatMap((u) => byUser.get(u) ?? []);
      if (devices.length === 0) continue;
      const covered =
        !run.refreshing &&
        !forceRefresh &&
        devices.every((d) => this.runtimes.has(runtimeKeyOf(d)));
      if (loaded) this.probedRooms.add(roomId);
      if (!covered) plans.push({ roomId, devices });
    }
    if (plans.length === 0) return this.finishRun(run);

    if (run.kind !== 'room' && !sawUnloaded) this.fullDiscoveryDone = true;
    this.hasProbedWithDevices = true;
    run.timer = setTimeout(() => this.finishRun(run), USAGE_TIMEOUT);
    for (const { roomId, devices } of plans) {
      const requestId = randomUuid();
      const query: ActiveQuery = { run, roomId, devices, answered: false };
      this.queries.set(requestId, query);
      void sendEncryptedToDeviceRequest(
        this.mx,
        USAGE_REQUEST,
        devices,
        { version: 1, request_id: requestId, room_id: roomId, force_refresh: forceRefresh },
        run.abort.signal,
        () => query.answered
      );
    }
  }

  private onResponse = (payload: ReceivedToDeviceMessage): void => {
    void this.receiveResponse(payload).catch(() => undefined);
  };

  private async receiveResponse({
    message,
    encryptionInfo,
  }: ReceivedToDeviceMessage): Promise<void> {
    if (
      !this.active() ||
      message.type !== USAGE_RESPONSE ||
      !encryptionInfo ||
      encryptionInfo.sender !== message.sender
    )
      return;
    const snapshot = parseProviderUsageResponse(message.content);
    const query = snapshot ? this.queries.get(snapshot.request_id) : undefined;
    const device = query?.devices.find(
      (d) => d.userId === message.sender && d.curveKey === encryptionInfo.senderCurve25519KeyBase64
    );
    if (
      !snapshot ||
      !query ||
      !device ||
      !(await isCurrentModelRuntime(this.mx, device)) ||
      !this.active() ||
      !this.runs.has(query.run)
    )
      return;

    const runtimeId = runtimeKeyOf(device);
    query.answered = true;
    this.lastAnsweringRoomId = query.roomId;
    this.runtimes.set(runtimeId, { runtime: { ...device, id: runtimeId }, snapshot });
    if (!this.selectedRuntimeId || !this.runtimes.has(this.selectedRuntimeId))
      this.selectedRuntimeId = runtimeId;
    if (query.run.refreshing && this.selectedRuntimeId === runtimeId) query.run.refreshing = false;
    this.publish();
  }

  private onSync = (state: SyncState): void => {
    if (state === SyncState.Stopped) this.dispose();
    else if (isSyncReady(state)) this.scheduleStartupProbe();
  };

  private onDevices = (users: string[]): void => {
    if (!this.canAutoProbe()) return;
    const rooms = this.orderedJoinedRooms();
    const candidates = new Set(rooms.flatMap((r) => joinedModelCandidates(this.mx, r)));
    if (users.some((id) => candidates.has(id))) this.runProbe('startup', rooms, false, false);
  };

  private onMembership = (_event: unknown, member: RoomMember): void => {
    if (member.membership !== 'join') return;
    const room = typeof this.mx.getRoom === 'function' ? this.mx.getRoom(member.roomId) : null;
    if (!room || !joinedModelCandidates(this.mx, room).includes(member.userId)) return;
    this.probedRooms.delete(room.roomId);
    this.fullDiscoveryDone = false;
    if (this.canAutoProbe())
      this.runProbe('startup', this.orderedJoinedRooms(room.roomId), false, false);
  };

  private publish(): void {
    const entries = [...this.runtimes.values()];
    const available = entries.length > 0;
    const loading = !available && [...this.runs].some((r) => r.kind !== 'startup');
    const refreshing = available && [...this.runs].some((r) => r.refreshing);
    const selected =
      (this.selectedRuntimeId ? this.runtimes.get(this.selectedRuntimeId) : undefined) ??
      entries[0];
    this.selectedRuntimeId = selected?.runtime.id;
    const status: ProviderUsageStatus = available
      ? 'ready'
      : loading
      ? 'loading'
      : this.hasProbedWithDevices
      ? 'unavailable'
      : 'idle';
    this.state = {
      status,
      available,
      hasLowQuota: entries.some((e) => hasLowQuotaInSnapshot(e.snapshot)),
      loading,
      refreshing,
      runtimes: available ? entries.map((e) => e.runtime) : INITIAL_STATE.runtimes,
      selectedRuntimeId: this.selectedRuntimeId,
      snapshot: selected?.snapshot,
      snapshotsByRuntime: available
        ? Object.fromEntries(entries.map((e) => [e.runtime.id, e.snapshot]))
        : INITIAL_STATE.snapshotsByRuntime,
    };
    this.listeners.forEach((listener) => listener());
  }

  dispose = (): void => {
    if (this.phase === 'disposed') return;
    this.phase = 'disposed';
    this.startupScheduled = false;
    for (const run of [...this.runs]) this.cancelRun(run);
    if (typeof this.mx.removeListener === 'function') {
      this.mx.removeListener(ClientEvent.ReceivedToDeviceMessage, this.onResponse);
      this.mx.removeListener(ClientEvent.Sync, this.onSync);
      this.mx.removeListener(CryptoEvent.DevicesUpdated, this.onDevices);
      this.mx.removeListener(RoomMemberEvent.Membership, this.onMembership);
    }
  };
}

export const getProviderUsageController = (mx: MatrixClient): ProviderUsageController => {
  const existing = controllers.get(mx);
  if (existing) return existing;
  const controller = new ProviderUsageController(mx);
  controllers.set(mx, controller);
  return controller;
};

export const disposeProviderUsageController = (mx: MatrixClient): void =>
  controllers.get(mx)?.dispose();
