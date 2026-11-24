import { SyncState, type MatrixClient, type Room } from 'matrix-js-sdk';
import { encodeBase64 } from 'matrix-js-sdk/lib/base64';
import type { MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc';
import { StateEvent } from '../matrix/types/room';
import { sendCallKey } from './callKeyProvider';
import {
  activeMemberships,
  membershipIdentity,
  SCREEN_ONLY_MEMBER_KEY,
  SCREEN_PARENT_DEVICE_KEY,
  type CallMember,
} from './callMemberships';
import { screenCompanionDeviceId } from './callResume';
import { requestSfuGrant } from './rtcFocus';
import {
  nativeScreenShare,
  type NativeScreenSharePlugin,
  type NativeScreenShareSheetStrings,
  type NativeScreenShareStateEvent,
} from './nativeScreenShare';

const CALL_MEMBER = StateEvent.GroupCallMemberPrefix as string;
const COMPANION_EXPIRES_MS = 120_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const NATIVE_LEASE_MS = 90_000;
const RENEWAL_INTERVAL_MS = 60_000;
const LEAVE_WITHDRAW_TIMEOUT_MS = 5_000;
const JOIN_GRACE_MS = 10_000;
const USE_KEY_DELAY_MS = 1_000;

const randomKey = () => crypto.getRandomValues(new Uint8Array(32));
const sentMarker = (identity: string, createdTs: number, keyIndex: number) =>
  `${identity} ${createdTs} ${keyIndex}`;

const errorDetail = (error: unknown): string | undefined => {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return typeof error === 'string' && error.trim() ? error.trim() : undefined;
};

/** Matches `MembershipManager.makeMembershipStateKey` for the room's version. */
export const companionMembershipStateKey = (
  room: Pick<Room, 'getVersion'>,
  userId: string,
  screenDeviceId: string
): string => {
  const base = `${userId}_${screenDeviceId}_m.call`;
  return /^org\.matrix\.msc(3757|3779)\b/.test(room.getVersion()) ? base : `_${base}`;
};

export type NativeScreenShareSessionOptions = {
  mx: MatrixClient;
  room: Room;
  session: Pick<MatrixRTCSession, 'memberships'>;
  serviceUrl: string;
  primaryDeviceId: string;
  encrypted: boolean;
  strings?: NativeScreenShareSheetStrings;
  onScreenKey?: (key: Uint8Array, keyIndex: number, identity: string) => void;
  onStateChange?: (state: 'broadcasting' | 'stopped', reason?: string, detail?: string) => void;
  plugin?: NativeScreenSharePlugin;
};

/**
 * Manages the synthetic `<deviceId>-screen` MatrixRTC companion membership, SFU grant,
 * fail-closed heartbeat lease, and E2EE key distribution/rotation for native iOS screen sharing.
 */
export class NativeScreenShareSession {
  readonly screenDeviceId: string;
  readonly screenIdentity: string;
  readonly stateKey: string;
  private readonly plugin: NativeScreenSharePlugin;
  private generation?: number;
  private broadcasting = false;
  private closed = false;
  private broadcastStartedAt = 0;
  private lastRenewalAt = 0;
  private currentKey?: Uint8Array;
  private keyIndex = 0;
  private keyCreatedAt = 0;
  private knownPeers = new Map<string, CallMember>();
  private readonly keysSent = new Set<string>();
  private rolloutInFlight = false;
  private rolloutPending = false;
  private listenerHandle?: { remove: () => void | Promise<void> };
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private wakeDelay?: () => void;
  private cleanupPromise?: Promise<void>;

  constructor(private readonly opts: NativeScreenShareSessionOptions) {
    this.plugin = opts.plugin ?? nativeScreenShare;
    this.screenDeviceId = screenCompanionDeviceId(opts.primaryDeviceId);
    const userId = opts.mx.getSafeUserId();
    this.screenIdentity = `${userId}:${this.screenDeviceId}`;
    this.stateKey = companionMembershipStateKey(opts.room, userId, this.screenDeviceId);
  }

  get isBroadcasting(): boolean {
    return this.broadcasting;
  }

  async start(): Promise<void> {
    if (this.closed) return;
    try {
      const token = await this.opts.mx.getOpenIdToken();
      if (this.closed) return;
      const grant = await requestSfuGrant(this.opts.serviceUrl, {
        roomId: this.opts.room.roomId,
        deviceId: this.screenDeviceId,
        token,
      });
      if (this.closed) return;
      if (this.opts.encrypted) {
        this.currentKey = randomKey();
        this.keyIndex = 0;
        this.keyCreatedAt = Date.now();
      }
      const handle = await this.plugin.addListener('stateChange', this.onNativeStateChange);
      if (this.closed) {
        await Promise.resolve(handle.remove()).catch(() => undefined);
        return;
      }
      this.listenerHandle = handle;
      const { generation } = await this.plugin.start({
        url: grant.url,
        token: grant.jwt,
        identity: this.screenIdentity,
        encrypted: this.opts.encrypted,
        ...(this.opts.encrypted && this.currentKey
          ? { keyBase64: encodeBase64(this.currentKey), keyIndex: this.keyIndex }
          : {}),
        allowedIdentities: this.readAllowedIdentities(),
        leaseMs: NATIVE_LEASE_MS,
        ...(this.opts.strings ? { strings: this.opts.strings } : {}),
      });
      if (this.closed) {
        await this.plugin.stop().catch(() => undefined);
        return;
      }
      this.generation = generation;
    } catch (error) {
      await this.cleanup({ stopNative: false, reason: 'start_failed', detail: errorDetail(error) });
      throw error;
    }
  }

  onMembershipsChanged(): void {
    if (this.closed || this.generation === undefined) return;
    void this.plugin
      .updateAllowedParticipants({
        generation: this.generation,
        identities: this.readAllowedIdentities(),
      })
      .catch(() => undefined);
    if (this.opts.encrypted && this.broadcasting && this.currentKey) {
      if (this.rolloutInFlight) this.rolloutPending = true;
      else void this.runMembershipSync();
    }
    if (this.broadcasting) this.sendHeartbeat();
  }

  onPeerConnected(identity: string): void {
    if (this.closed || !this.broadcasting || !this.opts.encrypted || !this.currentKey) return;
    const member = this.readRealPeers().get(identity);
    if (!member || this.keysSent.has(sentMarker(identity, member.createdTs, this.keyIndex))) return;
    void this.deliverKey(member, this.currentKey, this.keyIndex);
  }

  onForeground(): void {
    this.sendHeartbeat();
  }

  stop(): Promise<void> {
    return this.cleanup({ stopNative: true, reason: 'user' });
  }

  private readonly onNativeStateChange = (event: NativeScreenShareStateEvent) => {
    if (this.closed) return;
    if (this.generation !== undefined && event.generation !== this.generation) return;
    if (event.state === 'broadcasting') this.onBroadcastStarted(event.generation);
    else if (event.state === 'stopped' && this.generation !== undefined) {
      void this.cleanup({ stopNative: false, reason: event.reason, detail: event.detail });
    }
  };

  private onBroadcastStarted(generation: number): void {
    if (this.broadcasting || this.closed) return;
    this.generation ??= generation;
    this.broadcasting = true;
    this.broadcastStartedAt = Date.now();
    this.lastRenewalAt = this.broadcastStartedAt;
    if (this.opts.encrypted) this.keyCreatedAt = this.broadcastStartedAt;
    this.opts.onStateChange?.('broadcasting');
    void this.publishCompanionMembership(false);
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
    this.knownPeers = this.readRealPeers();
    if (this.opts.encrypted && this.currentKey) {
      this.opts.onScreenKey?.(this.currentKey, this.keyIndex, this.screenIdentity);
      this.knownPeers.forEach((member) => {
        if (this.currentKey) void this.deliverKey(member, this.currentKey, this.keyIndex);
      });
    }
  }

  private existingCompanionCreatedTs(): number {
    const userId = this.opts.mx.getSafeUserId();
    const existing = this.opts.session.memberships.find(
      (membership) => membership.userId === userId && membership.deviceId === this.screenDeviceId
    );
    const ts = existing?.createdTs();
    return typeof ts === 'number' && ts > 0 ? ts : this.broadcastStartedAt;
  }

  private async publishCompanionMembership(renewal: boolean): Promise<void> {
    if (this.closed) return;
    const now = Date.now();
    if (renewal) this.lastRenewalAt = now;
    const createdTs = renewal ? this.existingCompanionCreatedTs() : this.broadcastStartedAt;
    const content = {
      application: 'm.call',
      call_id: '',
      scope: 'm.room',
      device_id: this.screenDeviceId,
      membershipID: this.screenIdentity,
      expires: renewal
        ? COMPANION_EXPIRES_MS + Math.max(1, now - createdTs, now - this.broadcastStartedAt)
        : COMPANION_EXPIRES_MS,
      'm.call.intent': 'video',
      focus_active: { type: 'livekit', focus_selection: 'multi_sfu' },
      foci_preferred: [
        {
          type: 'livekit',
          livekit_service_url: this.opts.serviceUrl,
          livekit_alias: this.opts.room.roomId,
        },
      ],
      [SCREEN_ONLY_MEMBER_KEY]: true,
      [SCREEN_PARENT_DEVICE_KEY]: this.opts.primaryDeviceId,
      ...(renewal ? { created_ts: createdTs } : {}),
    };
    const write = this.opts.mx.sendStateEvent(
      this.opts.room.roomId,
      CALL_MEMBER as never,
      content as never,
      this.stateKey
    );
    if (renewal) {
      await write.catch(() => undefined);
      return;
    }
    try {
      await write;
    } catch (error) {
      if (!this.closed) {
        void this.cleanup({
          stopNative: true,
          reason: 'publish_failed',
          detail: errorDetail(error),
        });
      }
    }
  }

  private sendHeartbeat(): void {
    if (this.closed || !this.broadcasting || this.generation === undefined) return;
    const syncState = this.opts.mx.getSyncState();
    if (
      syncState !== SyncState.Syncing &&
      syncState !== SyncState.Prepared &&
      syncState !== SyncState.Catchup
    ) {
      return;
    }
    void this.plugin.heartbeat({ generation: this.generation }).catch(() => undefined);
    const key = this.currentKey;
    if (this.opts.encrypted && key) {
      for (const [id, member] of this.readRealPeers()) {
        if (
          this.knownPeers.get(id)?.createdTs === member.createdTs &&
          !this.keysSent.has(sentMarker(id, member.createdTs, this.keyIndex))
        ) {
          void this.deliverKey(member, key, this.keyIndex);
        }
      }
    }
    if (Date.now() - this.lastRenewalAt >= RENEWAL_INTERVAL_MS) {
      void this.publishCompanionMembership(true);
    }
  }

  private async runMembershipSync(): Promise<void> {
    this.rolloutInFlight = true;
    try {
      do {
        this.rolloutPending = false;
        if (this.closed || !this.broadcasting || !this.currentKey || this.generation === undefined)
          return;
        const currentPeers = this.readRealPeers();
        const anyLeft = [...this.knownPeers.entries()].some(
          ([id, prev]) => currentPeers.get(id)?.createdTs !== prev.createdTs
        );
        const joined = [...currentPeers.entries()]
          .filter(([id, next]) => this.knownPeers.get(id)?.createdTs !== next.createdTs)
          .map(([, member]) => member);
        this.knownPeers = currentPeers;

        if (anyLeft || (joined.length > 0 && Date.now() - this.keyCreatedAt > JOIN_GRACE_MS)) {
          // eslint-disable-next-line no-await-in-loop -- serializes coalesced key rollouts
          await this.rotateKey([...currentPeers.values()]);
        } else if (joined.length > 0) {
          const { currentKey: key, keyIndex } = this;
          // eslint-disable-next-line no-await-in-loop -- serializes coalesced key rollouts
          await Promise.allSettled(joined.map((member) => this.deliverKey(member, key, keyIndex)));
        }
      } while (this.rolloutPending && !this.closed && this.broadcasting);
    } finally {
      this.rolloutInFlight = false;
    }
  }

  private async rotateKey(peers: CallMember[]): Promise<void> {
    if (this.closed || !this.broadcasting || this.generation === undefined) return;
    const nextKey = randomKey();
    const nextIndex = (this.keyIndex + 1) % 256;
    this.currentKey?.fill(0);
    this.currentKey = nextKey;
    this.keyIndex = nextIndex;
    this.keysSent.clear();
    this.keyCreatedAt = Date.now();
    this.opts.onScreenKey?.(nextKey, nextIndex, this.screenIdentity);
    await Promise.allSettled(peers.map((member) => this.deliverKey(member, nextKey, nextIndex)));
    if (this.closed || !this.broadcasting) return;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.wakeDelay = undefined;
        resolve();
      };
      const timer = setTimeout(finish, USE_KEY_DELAY_MS);
      this.wakeDelay = finish;
    });
    if (this.closed || !this.broadcasting || this.generation === undefined) return;
    await this.plugin
      .setKey({
        generation: this.generation,
        keyBase64: encodeBase64(nextKey),
        keyIndex: nextIndex,
      })
      .catch(() => undefined);
  }

  private async deliverKey(member: CallMember, key: Uint8Array, keyIndex: number): Promise<void> {
    const marker = sentMarker(membershipIdentity(member), member.createdTs, keyIndex);
    if (this.keysSent.has(marker)) return;
    this.keysSent.add(marker);
    await sendCallKey(this.opts.mx, {
      roomId: this.opts.room.roomId,
      key,
      keyIndex,
      memberId: this.screenIdentity,
      claimedDeviceId: this.screenDeviceId,
      to: member,
    }).catch(() => {
      this.keysSent.delete(marker);
    });
  }

  private readAllowedIdentities(): string[] {
    const allowed = new Set<string>([
      `${this.opts.mx.getSafeUserId()}:${this.opts.primaryDeviceId}`,
    ]);
    activeMemberships(this.opts.session).forEach((member) => {
      if (!member.screenOnly) allowed.add(membershipIdentity(member));
    });
    return [...allowed];
  }

  private readRealPeers(): Map<string, CallMember> {
    const myUserId = this.opts.mx.getSafeUserId();
    const peers = new Map<string, CallMember>();
    activeMemberships(this.opts.session).forEach((member) => {
      if (member.screenOnly) return;
      if (member.userId === myUserId && member.deviceId === this.opts.primaryDeviceId) return;
      peers.set(membershipIdentity(member), member);
    });
    return peers;
  }

  private cleanup({
    stopNative,
    reason,
    detail,
  }: {
    stopNative: boolean;
    reason?: string;
    detail?: string;
  }): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;
    this.closed = true;
    const shouldWithdraw = this.broadcasting;
    this.broadcasting = false;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    this.wakeDelay?.();
    const handle = this.listenerHandle;
    this.listenerHandle = undefined;
    this.currentKey?.fill(0);
    this.currentKey = undefined;
    if (detail !== undefined) this.opts.onStateChange?.('stopped', reason, detail);
    else this.opts.onStateChange?.('stopped', reason);

    const tasks: Array<Promise<unknown>> = [];
    if (handle) tasks.push(Promise.resolve(handle.remove()));
    if (stopNative) tasks.push(this.plugin.stop());
    if (shouldWithdraw) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const withdraw = this.opts.mx
        .sendStateEvent(this.opts.room.roomId, CALL_MEMBER as never, {} as never, this.stateKey)
        .catch(() => undefined);
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, LEAVE_WITHDRAW_TIMEOUT_MS);
      });
      tasks.push(
        Promise.race([withdraw, timeout]).finally(() => {
          clearTimeout(timer);
        })
      );
    }
    this.cleanupPromise = Promise.allSettled(tasks).then(() => undefined);
    return this.cleanupPromise;
  }
}
