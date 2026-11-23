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

export type ProviderUsageRuntime = {
  id: string;
  userId: string;
  deviceId: string;
  curveKey: string;
};
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

type RuntimeEntry = { runtime: ProviderUsageRuntime; snapshot: ProviderUsageSnapshot };
type ActiveQuery = { generation: number; roomId: string; devices: ModelRuntime[] };
type DiscoveryOptions = {
  preferredRoomId?: string;
  forceRefresh: boolean;
  background: boolean;
  roomOnly: boolean;
};

const MAX_PROBE_PLANS = 16;
const MAX_ROOMS_TO_SCAN = 200;
const HYDRATE_CONCURRENCY = 4;
const BATCH_SIZE = 64;
const EMPTY_RUNTIMES: readonly ProviderUsageRuntime[] = Object.freeze([]);
const EMPTY_SNAPSHOTS: Readonly<Record<string, ProviderUsageSnapshot>> = Object.freeze({});

const initialState = (): ProviderUsageState => ({
  status: 'idle',
  available: false,
  hasLowQuota: false,
  loading: false,
  refreshing: false,
  runtimes: EMPTY_RUNTIMES,
  selectedRuntimeId: undefined,
  snapshot: undefined,
  snapshotsByRuntime: EMPTY_SNAPSHOTS,
});

const runtimeKeyOf = (d: Pick<ModelRuntime, 'userId' | 'deviceId'>): string =>
  `${d.userId}:${d.deviceId}`;
const modelRuntimeKeyOf = (
  d: Pick<ProviderUsageRuntime, 'userId' | 'deviceId' | 'curveKey'>
): string => JSON.stringify([d.userId, d.deviceId, d.curveKey]);
const isSyncReady = (s: SyncState | null | undefined): boolean =>
  s === SyncState.Prepared || s === SyncState.Syncing;

/** Strictly look up the snapshot for a specific authenticated runtime identity; never falls back. */
export const snapshotForRuntime = (
  state: Pick<ProviderUsageState, 'runtimes' | 'snapshotsByRuntime'>,
  runtime: RuntimeIdentity | undefined
): ProviderUsageSnapshot | undefined => {
  if (!runtime) return undefined;
  if (typeof runtime === 'string') {
    const direct = state.snapshotsByRuntime[runtime];
    if (direct) return direct;
    const matched = state.runtimes.find((r) => modelRuntimeKeyOf(r) === runtime);
    return matched ? state.snapshotsByRuntime[matched.id] : undefined;
  }
  const matched = state.runtimes.find(
    (r) =>
      r.userId === runtime.userId &&
      r.deviceId === runtime.deviceId &&
      r.curveKey === runtime.curveKey
  );
  return matched ? state.snapshotsByRuntime[matched.id] : undefined;
};

const controllers = new WeakMap<MatrixClient, ProviderUsageController>();

export class ProviderUsageController {
  private readonly userId: string | null;
  private owners = 0;
  private started = false;
  private disposed = false;
  private backgroundScheduled = false;
  private hasProbedWithDevices = false;
  private hasExplicitFullProbe = false;
  private lastAnsweringRoomId?: string;
  private generation = 0;
  private inFlightAbort?: AbortController;
  private inFlightTimer?: ReturnType<typeof setTimeout>;
  private inFlightBackground = false;
  private inFlightTotalDevices = 0;
  private readonly inFlightAnswered = new Set<string>();
  private loading = false;
  private refreshing = false;
  private selectedRuntimeId?: string;
  private readonly probedRoomIds = new Set<string>();
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private readonly queries = new Map<string, ActiveQuery>();
  private readonly listeners = new Set<() => void>();
  private state: ProviderUsageState = initialState();

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
    if (!this.started && !this.disposed) this.start();
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

  ensureLoaded = (roomId?: string): void => {
    if (!this.active()) return;
    if (this.runtimes.size > 0) {
      if (!roomId || this.probedRoomIds.has(roomId)) return;
      if (this.inFlightAbort && !this.inFlightBackground) return;
      this.startDiscovery({
        preferredRoomId: roomId,
        forceRefresh: false,
        background: false,
        roomOnly: true,
      });
      return;
    }
    if (this.inFlightAbort) {
      if (this.inFlightBackground) {
        // Promote quiet startup probe to explicit discovery so lazy room members hydrate.
        this.startDiscovery({
          preferredRoomId: roomId,
          forceRefresh: false,
          background: false,
          roomOnly: false,
        });
      }
      return;
    }
    if (roomId ? this.probedRoomIds.has(roomId) : this.hasExplicitFullProbe) return;
    this.startDiscovery({
      preferredRoomId: roomId,
      forceRefresh: false,
      background: false,
      roomOnly: false,
    });
  };

  refresh = (force = false): void => {
    if (!this.active()) return;
    this.probedRoomIds.clear();
    this.startDiscovery({
      preferredRoomId: this.lastAnsweringRoomId,
      forceRefresh: force,
      background: false,
      roomOnly: false,
    });
  };

  private start(): void {
    if (
      (this.started && !this.disposed) ||
      typeof this.mx.on !== 'function' ||
      this.mx.getSyncState?.() === SyncState.Stopped ||
      (typeof this.mx.getUserId === 'function' && this.mx.getUserId() !== this.userId)
    )
      return;
    this.started = true;
    this.disposed = false;
    this.mx.on(ClientEvent.ReceivedToDeviceMessage, this.onResponse);
    this.mx.on(ClientEvent.Sync, this.onSync);
    this.mx.on(CryptoEvent.DevicesUpdated, this.onDevices);
    this.mx.on(RoomMemberEvent.Membership, this.onMembership);
    if (isSyncReady(this.mx.getSyncState?.())) this.scheduleBackgroundProbe();
  }

  private active(): boolean {
    if (!this.started || this.disposed) return false;
    return typeof this.mx.getUserId !== 'function' || this.mx.getUserId() === this.userId;
  }

  private isCurrent(gen: number): boolean {
    return this.active() && this.generation === gen && this.inFlightAbort !== undefined;
  }

  private scheduleBackgroundProbe(): void {
    if (this.backgroundScheduled || !this.active()) return;
    this.backgroundScheduled = true;
    void Promise.resolve().then(() => {
      if (this.canAutoProbe()) {
        this.startDiscovery({ forceRefresh: false, background: true, roomOnly: false });
      }
    });
  }

  private cancelInFlight(): void {
    this.generation += 1;
    clearTimeout(this.inFlightTimer);
    this.inFlightTimer = undefined;
    this.inFlightAbort?.abort();
    this.inFlightAbort = undefined;
    this.inFlightBackground = false;
    this.inFlightTotalDevices = 0;
    this.inFlightAnswered.clear();
    this.queries.clear();
  }

  private startDiscovery(options: DiscoveryOptions): void {
    this.cancelInFlight();
    const gen = this.generation;
    const abort = new AbortController();
    this.inFlightAbort = abort;
    this.inFlightBackground = options.background;
    this.loading = !options.background && this.runtimes.size === 0;
    this.refreshing = !options.background && !options.roomOnly && this.runtimes.size > 0;
    this.publish();
    void this.executeDiscovery(gen, abort.signal, options);
  }

  private orderedJoinedRooms(preferredRoomId?: string, roomOnly = false): Room[] {
    const rooms = typeof this.mx.getRooms === 'function' ? this.mx.getRooms() : [];
    const joined = rooms.filter((room) =>
      typeof room.getMyMembership === 'function'
        ? room.getMyMembership() === 'join'
        : !this.userId || room.getMember(this.userId)?.membership === 'join'
    );
    const byId = new Map(joined.map((room) => [room.roomId, room]));
    if (roomOnly) {
      const target = preferredRoomId ? byId.get(preferredRoomId) : undefined;
      return target ? [target] : [];
    }
    const ordered: Room[] = [];
    const take = (id?: string) => {
      const room = id ? byId.get(id) : undefined;
      if (!room || !id) return;
      byId.delete(id);
      ordered.push(room);
    };
    take(preferredRoomId);
    take(this.lastAnsweringRoomId);
    for (const room of byId.values()) {
      if (ordered.length >= MAX_ROOMS_TO_SCAN) break;
      ordered.push(room);
    }
    return ordered;
  }

  private async executeDiscovery(
    gen: number,
    signal: AbortSignal,
    { preferredRoomId, forceRefresh, background, roomOnly }: DiscoveryOptions
  ): Promise<void> {
    const rooms = this.orderedJoinedRooms(preferredRoomId, roomOnly);
    const seenUsers = new Set<string>();
    const candidatePlans: Array<{ roomId: string; users: string[] }> = [];

    for (
      let i = 0;
      i < rooms.length && candidatePlans.length < MAX_PROBE_PLANS;
      i += HYDRATE_CONCURRENCY
    ) {
      const batch = rooms.slice(i, i + HYDRATE_CONCURRENCY);
      if (!background) {
        const toHydrate = batch.filter(
          (room) =>
            typeof room.membersLoaded === 'function' &&
            !room.membersLoaded() &&
            typeof room.loadMembersIfNeeded === 'function'
        );
        if (toHydrate.length > 0) {
          await Promise.allSettled(toHydrate.map((room) => room.loadMembersIfNeeded()));
          if (!this.isCurrent(gen)) return;
        }
      }
      for (const room of batch) {
        const users = joinedModelCandidates(this.mx, room);
        const newUsers = users.filter((u) => !seenUsers.has(u));
        if (newUsers.length === 0) {
          if (!background) this.probedRoomIds.add(room.roomId);
          continue;
        }
        users.forEach((u) => seenUsers.add(u));
        candidatePlans.push({ roomId: room.roomId, users: newUsers });
        if (candidatePlans.length >= MAX_PROBE_PLANS) break;
      }
    }

    const uniqueUsers = [...seenUsers];
    if (!background && !roomOnly) this.hasExplicitFullProbe = true;
    if (uniqueUsers.length === 0) return this.finishInFlight(gen);

    const signed: ModelRuntime[] = [];
    try {
      for (let i = 0; i < uniqueUsers.length; i += BATCH_SIZE) {
        signed.push(...(await signedModelDevices(this.mx, uniqueUsers.slice(i, i + BATCH_SIZE))));
      }
    } catch {
      signed.length = 0;
    }
    if (!this.isCurrent(gen)) return;

    const byUser = new Map<string, ModelRuntime[]>();
    for (const d of signed) {
      const list = byUser.get(d.userId) ?? [];
      list.push(d);
      byUser.set(d.userId, list);
    }

    const targeted = new Set<string>();
    const plans: Array<{ roomId: string; devices: ModelRuntime[] }> = [];
    for (const { roomId, users } of candidatePlans) {
      const devices: ModelRuntime[] = [];
      for (const userId of users) {
        for (const d of byUser.get(userId) ?? []) {
          if (targeted.has(d.id)) continue;
          if (roomOnly && this.runtimes.has(runtimeKeyOf(d))) continue;
          targeted.add(d.id);
          devices.push(d);
        }
      }
      this.probedRoomIds.add(roomId);
      if (devices.length > 0) plans.push({ roomId, devices });
    }
    if (plans.length === 0) return this.finishInFlight(gen);

    this.hasProbedWithDevices = true;
    this.inFlightTotalDevices = targeted.size;
    this.inFlightTimer = setTimeout(() => this.finishInFlight(gen), USAGE_TIMEOUT);

    for (const plan of plans) {
      const requestId = randomUuid();
      this.queries.set(requestId, { generation: gen, roomId: plan.roomId, devices: plan.devices });
      void sendEncryptedToDeviceRequest(
        this.mx,
        USAGE_REQUEST,
        plan.devices,
        { version: 1, request_id: requestId, room_id: plan.roomId, force_refresh: forceRefresh },
        signal,
        (deviceId) => this.inFlightAnswered.has(deviceId)
      );
    }
  }

  private finishInFlight(gen: number): void {
    if (!this.isCurrent(gen)) return;
    this.cancelInFlight();
    this.loading = false;
    this.refreshing = false;
    this.publish();
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
    if (!snapshot) return;
    const query = this.queries.get(snapshot.request_id);
    if (!query || !this.isCurrent(query.generation)) return;
    const device = query.devices.find(
      (d) => d.userId === message.sender && d.curveKey === encryptionInfo.senderCurve25519KeyBase64
    );
    if (
      !device ||
      !(await isCurrentModelRuntime(this.mx, device)) ||
      !this.isCurrent(query.generation)
    )
      return;

    const runtimeId = runtimeKeyOf(device);
    this.inFlightAnswered.add(device.id);
    this.lastAnsweringRoomId = query.roomId;
    this.runtimes.set(runtimeId, {
      runtime: {
        id: runtimeId,
        userId: device.userId,
        deviceId: device.deviceId,
        curveKey: device.curveKey,
      },
      snapshot,
    });
    if (!this.selectedRuntimeId || !this.runtimes.has(this.selectedRuntimeId))
      this.selectedRuntimeId = runtimeId;

    this.loading = false;
    if (this.refreshing && this.selectedRuntimeId === runtimeId) this.refreshing = false;
    if (this.inFlightAnswered.size >= this.inFlightTotalDevices)
      return this.finishInFlight(query.generation);
    this.publish();
  }

  private canAutoProbe(): boolean {
    return (
      this.active() && !this.hasProbedWithDevices && !this.inFlightAbort && this.runtimes.size === 0
    );
  }

  private onSync = (state: SyncState): void => {
    if (state === SyncState.Stopped) this.dispose();
    else if (isSyncReady(state)) this.scheduleBackgroundProbe();
  };

  private onDevices = (users: string[]): void => {
    if (!this.canAutoProbe()) return;
    const candidates = new Set(
      this.orderedJoinedRooms().flatMap((room) => joinedModelCandidates(this.mx, room))
    );
    if (users.some((id) => candidates.has(id))) {
      this.startDiscovery({ forceRefresh: false, background: true, roomOnly: false });
    }
  };

  private onMembership = (_event: unknown, member: RoomMember): void => {
    if (!this.canAutoProbe() || member.membership !== 'join') return;
    const room = typeof this.mx.getRoom === 'function' ? this.mx.getRoom(member.roomId) : null;
    if (room && joinedModelCandidates(this.mx, room).includes(member.userId)) {
      this.startDiscovery({
        preferredRoomId: room.roomId,
        forceRefresh: false,
        background: true,
        roomOnly: false,
      });
    }
  };

  private publish(): void {
    const entries = [...this.runtimes.values()];
    const available = entries.length > 0;
    const selected =
      (this.selectedRuntimeId ? this.runtimes.get(this.selectedRuntimeId) : undefined) ??
      entries[0];
    this.selectedRuntimeId = selected?.runtime.id;
    const status: ProviderUsageStatus = available
      ? 'ready'
      : this.loading
      ? 'loading'
      : this.hasProbedWithDevices
      ? 'unavailable'
      : 'idle';
    const snapshotsByRuntime: Record<string, ProviderUsageSnapshot> = {};
    for (const [id, entry] of this.runtimes) snapshotsByRuntime[id] = entry.snapshot;
    this.state = {
      status,
      available,
      hasLowQuota: entries.some((entry) => hasLowQuotaInSnapshot(entry.snapshot)),
      loading: this.loading,
      refreshing: this.refreshing,
      runtimes: available ? entries.map((entry) => entry.runtime) : EMPTY_RUNTIMES,
      selectedRuntimeId: this.selectedRuntimeId,
      snapshot: selected?.snapshot,
      snapshotsByRuntime: available ? snapshotsByRuntime : EMPTY_SNAPSHOTS,
    };
    this.listeners.forEach((listener) => listener());
  }

  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelInFlight();
    this.loading = false;
    this.refreshing = false;
    if (typeof this.mx.removeListener === 'function') {
      this.mx.removeListener(ClientEvent.ReceivedToDeviceMessage, this.onResponse);
      this.mx.removeListener(ClientEvent.Sync, this.onSync);
      this.mx.removeListener(CryptoEvent.DevicesUpdated, this.onDevices);
      this.mx.removeListener(RoomMemberEvent.Membership, this.onMembership);
    }
  };
}

export const getProviderUsageController = (mx: MatrixClient): ProviderUsageController => {
  let controller = controllers.get(mx);
  if (!controller) {
    controller = new ProviderUsageController(mx);
    controllers.set(mx, controller);
  }
  return controller;
};

export const disposeProviderUsageController = (mx: MatrixClient): void =>
  controllers.get(mx)?.dispose();
