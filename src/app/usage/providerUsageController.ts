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
};

type RuntimeEntry = { runtime: ProviderUsageRuntime; snapshot: ProviderUsageSnapshot };
type DiscoveryRun = {
  generation: number;
  background: boolean;
  abort: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  totalDevices: number;
  answeredDevices: Set<string>;
};
type ActiveQuery = { run: DiscoveryRun; roomId: string; devices: ModelRuntime[] };

const MAX_ROOMS = 16;
const BATCH_SIZE = 64;
const EMPTY_RUNTIMES: readonly ProviderUsageRuntime[] = Object.freeze([]);
const initialState = (): ProviderUsageState => ({
  status: 'idle',
  available: false,
  hasLowQuota: false,
  loading: false,
  refreshing: false,
  runtimes: EMPTY_RUNTIMES,
  selectedRuntimeId: undefined,
  snapshot: undefined,
});
const runtimeKeyOf = (d: Pick<ModelRuntime, 'userId' | 'deviceId'>): string =>
  `${d.userId}:${d.deviceId}`;
const isSyncReady = (s: SyncState | null | undefined): boolean =>
  s === SyncState.Prepared || s === SyncState.Syncing;

const controllers = new WeakMap<MatrixClient, ProviderUsageController>();

export class ProviderUsageController {
  private readonly userId: string | null;
  private owners = 0;
  private started = false;
  private disposed = false;
  private backgroundScheduled = false;
  private hasProbedWithDevices = false;
  private lastAnsweringRoomId?: string;
  private runGeneration = 0;
  private activeRun?: DiscoveryRun;
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
    if (!this.active() || this.runtimes.size > 0) return;
    if (this.activeRun) {
      if (this.activeRun.background) {
        this.activeRun.background = false;
        this.loading = true;
        this.publish();
      }
      return;
    }
    if (this.hasProbedWithDevices && (!roomId || this.probedRoomIds.has(roomId))) return;
    this.startDiscovery(roomId, false, false);
  };

  refresh = (force = false): void => {
    if (!this.active()) return;
    this.startDiscovery(this.lastAnsweringRoomId, force, false);
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

  private isCurrentRun(run: DiscoveryRun): boolean {
    return this.active() && this.activeRun === run && this.runGeneration === run.generation;
  }

  private scheduleBackgroundProbe(): void {
    if (this.backgroundScheduled || !this.active()) return;
    this.backgroundScheduled = true;
    void Promise.resolve().then(() => {
      if (this.active() && !this.hasProbedWithDevices && !this.activeRun && !this.runtimes.size)
        this.startDiscovery(undefined, false, true);
    });
  }

  private cancelActiveRun(): void {
    const cancelled = this.activeRun;
    if (!cancelled) return;
    clearTimeout(cancelled.timer);
    cancelled.abort.abort();
    this.activeRun = undefined;
    for (const [id, q] of this.queries) if (q.run === cancelled) this.queries.delete(id);
  }

  private startDiscovery(
    preferredRoomId: string | undefined,
    forceRefresh: boolean,
    background: boolean
  ): void {
    this.cancelActiveRun();
    this.runGeneration += 1;
    const run: DiscoveryRun = {
      generation: this.runGeneration,
      background,
      abort: new AbortController(),
      totalDevices: 0,
      answeredDevices: new Set(),
    };
    this.activeRun = run;
    this.loading = !background && this.runtimes.size === 0;
    this.refreshing = !background && this.runtimes.size > 0;
    this.publish();
    void this.executeDiscovery(run, preferredRoomId, forceRefresh);
  }

  private candidateRooms(preferredRoomId?: string): Array<{ room: Room; users: string[] }> {
    const rooms = typeof this.mx.getRooms === 'function' ? this.mx.getRooms() : [];
    const byId = new Map<string, { room: Room; users: string[] }>();
    for (const room of rooms) {
      const users = joinedModelCandidates(this.mx, room);
      if (users.length > 0) byId.set(room.roomId, { room, users });
    }
    const ordered: Array<{ room: Room; users: string[] }> = [];
    const take = (id?: string) => {
      const entry = id ? byId.get(id) : undefined;
      if (!entry || !id) return;
      byId.delete(id);
      ordered.push(entry);
    };
    take(preferredRoomId);
    take(this.lastAnsweringRoomId);
    for (const entry of byId.values()) {
      if (ordered.length >= MAX_ROOMS) break;
      ordered.push(entry);
    }
    return ordered;
  }

  private async executeDiscovery(
    run: DiscoveryRun,
    preferredRoomId: string | undefined,
    forceRefresh: boolean
  ): Promise<void> {
    const rooms = this.candidateRooms(preferredRoomId);
    const uniqueUsers = [...new Set(rooms.flatMap((entry) => entry.users))];
    if (uniqueUsers.length === 0) return this.finishRun(run);

    const signed: ModelRuntime[] = [];
    try {
      for (let i = 0; i < uniqueUsers.length; i += BATCH_SIZE) {
        signed.push(...(await signedModelDevices(this.mx, uniqueUsers.slice(i, i + BATCH_SIZE))));
      }
    } catch {
      signed.length = 0;
    }
    if (!this.isCurrentRun(run)) return;

    const byUser = new Map<string, ModelRuntime[]>();
    for (const d of signed) {
      const list = byUser.get(d.userId) ?? [];
      list.push(d);
      byUser.set(d.userId, list);
    }

    const targeted = new Set<string>();
    const plans: Array<{ roomId: string; devices: ModelRuntime[] }> = [];
    for (const { room, users } of rooms) {
      const devices: ModelRuntime[] = [];
      for (const userId of users) {
        for (const d of byUser.get(userId) ?? []) {
          if (targeted.has(d.id)) continue;
          targeted.add(d.id);
          devices.push(d);
        }
      }
      if (devices.length > 0) {
        this.probedRoomIds.add(room.roomId);
        plans.push({ roomId: room.roomId, devices });
      }
    }
    if (plans.length === 0) return this.finishRun(run);

    this.hasProbedWithDevices = true;
    run.totalDevices = targeted.size;
    run.timer = setTimeout(() => this.finishRun(run), USAGE_TIMEOUT);

    for (const plan of plans) {
      const requestId = randomUuid();
      this.queries.set(requestId, { run, roomId: plan.roomId, devices: plan.devices });
      void sendEncryptedToDeviceRequest(
        this.mx,
        USAGE_REQUEST,
        plan.devices,
        { version: 1, request_id: requestId, room_id: plan.roomId, force_refresh: forceRefresh },
        run.abort.signal,
        (deviceId) => run.answeredDevices.has(deviceId)
      );
    }
  }

  private finishRun(run: DiscoveryRun): void {
    if (!this.isCurrentRun(run)) return;
    this.cancelActiveRun();
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
    if (!query || !this.isCurrentRun(query.run)) return;
    const device = query.devices.find(
      (d) => d.userId === message.sender && d.curveKey === encryptionInfo.senderCurve25519KeyBase64
    );
    if (!device || !(await isCurrentModelRuntime(this.mx, device)) || !this.isCurrentRun(query.run))
      return;

    const runtimeId = runtimeKeyOf(device);
    query.run.answeredDevices.add(device.id);
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
    if (query.run.answeredDevices.size >= query.run.totalDevices) return this.finishRun(query.run);
    this.publish();
  }

  private onSync = (state: SyncState): void => {
    if (state === SyncState.Stopped) this.dispose();
    else if (isSyncReady(state)) this.scheduleBackgroundProbe();
  };

  private canAutoProbe(): boolean {
    return this.active() && !this.hasProbedWithDevices && !this.activeRun && this.runtimes.size === 0;
  }

  private onDevices = (users: string[]): void => {
    if (!this.canAutoProbe()) return;
    const candidates = new Set(this.candidateRooms().flatMap((entry) => entry.users));
    if (users.some((id) => candidates.has(id))) this.startDiscovery(undefined, false, true);
  };

  private onMembership = (_event: unknown, member: RoomMember): void => {
    if (!this.canAutoProbe() || member.membership !== 'join') return;
    const room = typeof this.mx.getRoom === 'function' ? this.mx.getRoom(member.roomId) : null;
    if (room && joinedModelCandidates(this.mx, room).includes(member.userId))
      this.startDiscovery(room.roomId, false, true);
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
    this.state = {
      status,
      available,
      hasLowQuota: entries.some((entry) => hasLowQuotaInSnapshot(entry.snapshot)),
      loading: this.loading,
      refreshing: this.refreshing,
      runtimes: available ? entries.map((entry) => entry.runtime) : EMPTY_RUNTIMES,
      selectedRuntimeId: this.selectedRuntimeId,
      snapshot: selected?.snapshot,
    };
    this.listeners.forEach((listener) => listener());
  }

  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelActiveRun();
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
