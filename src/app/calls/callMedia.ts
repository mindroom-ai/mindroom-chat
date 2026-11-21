import type { SfuGrant } from './rtcFocus';
import type { CallDeviceKind, CallDevices, CallVideoTrack } from './RoomCall';

/** Media frame key ring size shared with MindRoom agents and the native Mac call plugin. */
export const CALL_KEY_RING_SIZE = 256;

/** True when two ordered participant lists carry the same speaking, microphone and extra fields. */
export const sameParticipants = <T extends { speaking: boolean; microphone: boolean }>(
  a: readonly T[],
  b: readonly T[],
  sameExtra: (left: T, right: T) => boolean
): boolean =>
  a.length === b.length &&
  a.every((item, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      item.speaking === other.speaking &&
      item.microphone === other.microphone &&
      sameExtra(item, other)
    );
  });

/** One device on the media server, as a tile reads it. */
export type CallMediaParticipant = {
  speaking: boolean;
  microphone: boolean;
  video?: CallVideoTrack;
  screen?: CallVideoTrack;
};

/** What a media backend asks of, and tells, the call that owns it. */
export type CallMediaHost = {
  /** Whether the media identity is a member of the call now. */
  isMember(identity: string): boolean;
  /** Something a tile or the panel shows changed. */
  onChange(): void;
  /** A device joined the media server. */
  onParticipantConnected(identity: string): void;
  onPhase(phase: 'reconnecting' | 'connected'): void;
  /** The media server dropped this device for good. */
  onDisconnected(): void;
  onDevice(kind: CallDeviceKind, deviceId: string): void;
};

/** A call's media connection. Every method is safe before `connect` and after `disconnect`. */
export interface CallMedia {
  setKey(key: Uint8Array, index: number, identity: string, own: boolean): Promise<void>;
  /** False when `stopped()` turned true before the connection was made; rejects when it fails. */
  connect(
    grant: SfuGrant,
    options: { devices: CallDevices; stopped: () => boolean }
  ): Promise<boolean>;
  connected(): boolean;
  participant(identity: string, local: boolean): CallMediaParticipant | undefined;
  /** Only these devices are heard, and only they receive this device's tracks. */
  setMembers(identities: ReadonlySet<string>): void;
  setMicrophone(on: boolean): Promise<void>;
  setCamera(on: boolean): Promise<void>;
  setScreenShare(on: boolean): Promise<void>;
  screenShare(): boolean;
  setSound(on: boolean): void;
  setDevice(kind: CallDeviceKind, deviceId: string): Promise<void>;
  audioBlocked(): boolean;
  resumeAudio(): Promise<void>;
  microphoneTrack(): MediaStreamTrack | undefined;
  /** Stops what the page itself holds (listeners, audio elements, polling); synchronous. */
  silence(): void;
  disconnect(): Promise<void>;
  /** After `disconnect` settled: lets go of the rest (the encryption worker). */
  dispose(): void;
}
