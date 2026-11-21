import { encodeBase64 } from 'matrix-js-sdk/lib/base64';
import { randomUuid } from '../lib/randomUuid';
import {
  getNativeCallPlugin,
  nativeCallErrorCode,
  type MindRoomCallPlugin,
  type NativeCallSnapshot,
} from '../native/nativeCall';
import {
  CALL_KEY_RING_SIZE,
  sameParticipants,
  type CallMedia,
  type CallMediaHost,
  type CallMediaParticipant,
} from './callMedia';
import type { SfuGrant } from './rtcFocus';
import type { CallDeviceKind, CallDevices } from './RoomCall';

export const NATIVE_CALL_POLL_MS = 250;

/** Native LiveKit media connection (`MindRoomCall` Capacitor plugin) for `RoomCall` in the Mac app. */
export class NativeCallMedia implements CallMedia {
  private readonly encrypted: boolean;

  private readonly host: CallMediaHost;

  private readonly plugin: MindRoomCallPlugin;

  private id?: string;

  private last?: NativeCallSnapshot;

  private pendingKeys: Array<{ identity: string; index: number; key: string; own: boolean }> = [];

  private pendingMembers?: string[];

  private pendingSound?: boolean;

  private pollTimer?: number;

  private polling = false;

  private silenced = false;

  private disconnected = false;

  constructor(options: { encrypted: boolean; host: CallMediaHost; plugin?: MindRoomCallPlugin }) {
    this.encrypted = options.encrypted;
    this.host = options.host;
    this.plugin = options.plugin ?? getNativeCallPlugin();
  }

  setKey(key: Uint8Array, index: number, identity: string, own: boolean): Promise<void> {
    if (!Number.isInteger(index) || index < 0 || index >= CALL_KEY_RING_SIZE) {
      return Promise.reject(
        Object.assign(new Error('Invalid call key index'), { code: 'BAD_KEY' })
      );
    }
    const encoded = encodeBase64(key);
    if (this.id !== undefined) {
      return this.plugin.setKey({ id: this.id, identity, index, key: encoded, own });
    }
    this.pendingKeys.push({ identity, index, key: encoded, own });
    return Promise.resolve();
  }

  async connect(
    grant: SfuGrant,
    options: { devices: CallDevices; stopped: () => boolean }
  ): Promise<boolean> {
    if (options.stopped()) return false;
    const nonce = randomUuid();
    Object.assign(globalThis, { mindroomCallStart: nonce });
    const { id } = await this.plugin.connect({
      nonce,
      url: grant.url,
      token: grant.jwt,
      encrypted: this.encrypted,
    });
    this.id = id;
    this.last = {
      state: 'connected',
      local: { speaking: false, microphone: false },
      participants: [],
    };
    const keys = this.pendingKeys;
    this.pendingKeys = [];
    const members = this.pendingMembers;
    this.pendingMembers = undefined;
    const sound = this.pendingSound;
    this.pendingSound = undefined;
    for (const entry of keys) {
      // eslint-disable-next-line no-await-in-loop
      await this.plugin.setKey({ id, ...entry }).catch(() => undefined);
    }
    if (members !== undefined) {
      await this.plugin.setMembers({ id, identities: members }).catch(() => undefined);
    }
    if (sound !== undefined) {
      await this.plugin.setSound({ id, on: sound }).catch(() => undefined);
    }
    if (!this.silenced) {
      this.pollTimer = window.setInterval(() => {
        void this.poll();
      }, NATIVE_CALL_POLL_MS);
    }
    return true;
  }

  connected(): boolean {
    return this.id !== undefined && this.last?.state === 'connected';
  }

  participant(identity: string, local: boolean): CallMediaParticipant | undefined {
    if (this.id === undefined || !this.last) return undefined;
    if (local) {
      return {
        speaking: this.last.local.speaking,
        microphone: this.last.local.microphone,
      };
    }
    const remote = this.last.participants.find((item) => item.identity === identity);
    if (!remote) return undefined;
    return { speaking: remote.speaking, microphone: remote.microphone };
  }

  setMembers(identities: ReadonlySet<string>): void {
    const list = [...identities];
    if (this.id !== undefined) {
      void this.plugin.setMembers({ id: this.id, identities: list }).catch(() => undefined);
    } else {
      this.pendingMembers = list;
    }
  }

  async setMicrophone(on: boolean): Promise<void> {
    if (this.id === undefined) return;
    await this.plugin.setMicrophone({ id: this.id, on });
  }

  async setCamera(on: boolean): Promise<void> {
    if (on) throw new Error('Camera is not supported in native calls');
  }

  async setScreenShare(_on: boolean): Promise<void> {
    // Version 1 of native calls is audio only.
  }

  screenShare(): boolean {
    return false;
  }

  setSound(on: boolean): void {
    if (this.id !== undefined) {
      void this.plugin.setSound({ id: this.id, on }).catch(() => undefined);
    } else {
      this.pendingSound = on;
    }
  }

  async setDevice(_kind: CallDeviceKind, _deviceId: string): Promise<void> {
    // Mac Catalyst uses the system default input and output devices.
  }

  audioBlocked(): boolean {
    return false;
  }

  async resumeAudio(): Promise<void> {
    // Native playback is never autoplay-blocked.
  }

  microphoneTrack(): MediaStreamTrack | undefined {
    return undefined;
  }

  silence(): void {
    this.silenced = true;
    if (this.pollTimer !== undefined) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  async disconnect(): Promise<void> {
    if (this.id === undefined) return;
    await this.plugin.disconnect({ id: this.id }).catch(() => undefined);
  }

  dispose(): void {
    // Nothing outside the plugin to release.
  }

  private lose() {
    this.silence();
    if (this.disconnected) return;
    this.disconnected = true;
    if (this.last) {
      this.last = { ...this.last, state: 'disconnected' };
    }
    this.host.onDisconnected();
  }

  private async poll(): Promise<void> {
    if (this.silenced || this.polling || this.id === undefined) return;
    const sessionId = this.id;
    this.polling = true;
    try {
      const next = await this.plugin.snapshot({ id: sessionId });
      if (this.silenced || this.id !== sessionId) return;
      if (next.state === 'disconnected') {
        this.lose();
        return;
      }
      const prev = this.last;
      this.last = next;
      if (!prev) {
        this.host.onChange();
        return;
      }
      const known = new Set(prev.participants.map((item) => item.identity));
      for (const participant of next.participants) {
        if (!known.has(participant.identity)) {
          this.host.onParticipantConnected(participant.identity);
        }
      }
      if (prev.state !== 'reconnecting' && next.state === 'reconnecting') {
        this.host.onPhase('reconnecting');
      } else if (prev.state === 'reconnecting' && next.state === 'connected') {
        this.host.onPhase('connected');
      }
      const localChanged =
        prev.local.speaking !== next.local.speaking ||
        prev.local.microphone !== next.local.microphone;
      const participantsChanged = !sameParticipants(
        prev.participants,
        next.participants,
        (a, b) => a.identity === b.identity
      );
      if (localChanged || participantsChanged) {
        this.host.onChange();
      }
    } catch (error) {
      if (this.silenced || this.id !== sessionId) return;
      if (nativeCallErrorCode(error) === 'NOT_CONNECTED') {
        this.lose();
      }
    } finally {
      this.polling = false;
    }
  }
}
