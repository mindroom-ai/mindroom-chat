import { encodeBase64 } from 'matrix-js-sdk/lib/base64';
import { randomUuid } from '../lib/randomUuid';
import {
  getNativeCallPlugin,
  nativeCallErrorCode,
  type MindRoomCallPlugin,
  type NativeCallSnapshot,
} from '../native/nativeCall';
import type { CallMedia, CallMediaHost, CallMediaParticipant } from './callMedia';
import type { SfuGrant } from './rtcFocus';
import type { CallDeviceKind, CallDevices } from './RoomCall';

export const NATIVE_CALL_POLL_MS = 250;

const sameParticipants = (
  a: NativeCallSnapshot['participants'],
  b: NativeCallSnapshot['participants']
): boolean =>
  a.length === b.length &&
  a.every((item, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      item.identity === other.identity &&
      item.speaking === other.speaking &&
      item.microphone === other.microphone
    );
  });

/** Native LiveKit media connection (`MindRoomCall` Capacitor plugin) for `RoomCall` in the Mac app. */
export class NativeCallMedia implements CallMedia {
  private readonly encrypted: boolean;

  private readonly host: CallMediaHost;

  private readonly plugin: MindRoomCallPlugin;

  private id?: string;

  private last?: NativeCallSnapshot;

  private pending: Array<(id: string) => Promise<void>> = [];

  private pollTimer?: number;

  private polling = false;

  private silenced = false;

  private disconnected = false;

  constructor(options: { encrypted: boolean; host: CallMediaHost; plugin?: MindRoomCallPlugin }) {
    this.encrypted = options.encrypted;
    this.host = options.host;
    this.plugin = options.plugin ?? getNativeCallPlugin();
  }

  private send(operation: (id: string) => Promise<void>): Promise<void> {
    if (this.id !== undefined) return operation(this.id);
    this.pending.push(operation);
    return Promise.resolve();
  }

  setKey(key: Uint8Array, index: number, identity: string, own: boolean): Promise<void> {
    const encoded = encodeBase64(key);
    return this.send((id) => this.plugin.setKey({ id, identity, index, key: encoded, own }));
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
    const queued = this.pending;
    this.pending = [];
    for (const operation of queued) {
      // eslint-disable-next-line no-await-in-loop
      await operation(id).catch(() => undefined);
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
    void this.send((id) => this.plugin.setMembers({ id, identities: list }).catch(() => undefined));
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
    void this.send((id) => this.plugin.setSound({ id, on }).catch(() => undefined));
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
      const participantsChanged = !sameParticipants(prev.participants, next.participants);
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
