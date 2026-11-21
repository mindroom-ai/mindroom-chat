import {
  ConnectionState,
  isBrowserSupported,
  isE2EESupported,
  Room as MediaRoom,
  RoomEvent,
  Track,
  TrackEvent,
  type LocalTrackPublication,
  type RemoteTrack,
} from 'livekit-client';
import E2EEWorker from 'livekit-client/e2ee-worker?worker';
import { MatrixRtcKeyProvider } from './callKeyProvider';
import type { CallMedia, CallMediaHost, CallMediaParticipant } from './callMedia';
import type { SfuGrant } from './rtcFocus';
import type { CallDeviceKind, CallDevices, CallVideoTrack } from './RoomCall';

export const webCallMediaSupported = (encrypted: boolean): boolean =>
  isBrowserSupported() && (!encrypted || isE2EESupported());

/** LiveKit browser media connection (`livekit-client`) for `RoomCall`. */
export class WebCallMedia implements CallMedia {
  private readonly encrypted: boolean;

  private readonly roomId: string;

  private readonly host: CallMediaHost;

  private readonly keyProvider?: MatrixRtcKeyProvider;

  private room?: MediaRoom;

  private worker?: Worker;

  private audioHost?: HTMLElement;

  private sound = true;

  private readonly changed: () => void;

  constructor(options: { encrypted: boolean; roomId: string; host: CallMediaHost }) {
    this.encrypted = options.encrypted;
    this.roomId = options.roomId;
    this.host = options.host;
    this.changed = () => this.host.onChange();
    if (options.encrypted) this.keyProvider = new MatrixRtcKeyProvider();
  }

  async setKey(key: Uint8Array, index: number, identity: string, _own: boolean): Promise<void> {
    await this.keyProvider?.setParticipantKey(key, index, identity);
  }

  async connect(
    grant: SfuGrant,
    options: { devices: CallDevices; stopped: () => boolean }
  ): Promise<boolean> {
    if (this.keyProvider) this.worker = new E2EEWorker();
    const room = new MediaRoom({
      adaptiveStream: true,
      dynacast: true,
      // The call's lifetime leaves on `pagehide` after remembering the call for a reload; left to
      // itself, LiveKit drops the call already on `beforeunload`, and the reload finds it failed.
      disconnectOnPageLeave: false,
      audioCaptureDefaults: { deviceId: options.devices.audioinput },
      videoCaptureDefaults: { deviceId: options.devices.videoinput },
      audioOutput: { deviceId: options.devices.audiooutput },
      ...(this.keyProvider && this.worker
        ? { encryption: { keyProvider: this.keyProvider, worker: this.worker } }
        : {}),
    });
    this.room = room;
    this.watch(room);
    if (this.encrypted) await room.setE2EEEnabled(true);
    // The teardown of a call left meanwhile disconnected this room already; it stays so.
    if (options.stopped()) return false;
    await room.connect(grant.url, grant.jwt);
    return true;
  }

  connected(): boolean {
    return this.room?.state === ConnectionState.Connected;
  }

  participant(identity: string, local: boolean): CallMediaParticipant | undefined {
    const room = this.room;
    if (!room) return undefined;
    const participant = local ? room.localParticipant : room.remoteParticipants.get(identity);
    if (!participant) return undefined;
    const shown = (source: Track.Source) => {
      const publication = participant.getTrackPublication(source);
      return publication && !publication.isMuted
        ? (publication.track as CallVideoTrack | undefined)
        : undefined;
    };
    return {
      speaking: participant.isSpeaking,
      microphone: participant.isMicrophoneEnabled,
      video: shown(Track.Source.Camera),
      screen: shown(Track.Source.ScreenShare),
    };
  }

  setMembers(identities: ReadonlySet<string>): void {
    const room = this.room;
    if (!room) return;
    // Kept by LiveKit and sent again after a reconnect.
    room.localParticipant.setTrackSubscriptionPermissions(
      false,
      [...identities].map((participantIdentity) => ({ participantIdentity, allowAll: true }))
    );
    room.remoteParticipants.forEach((participant) => {
      const member = identities.has(participant.identity);
      participant.audioTrackPublications.forEach(({ track }) => {
        if (!track) return;
        if (member) this.attachAudio(track);
        else this.detachAudio(track);
      });
    });
  }

  async setMicrophone(on: boolean): Promise<void> {
    if (!this.room) return;
    await this.room.localParticipant.setMicrophoneEnabled(on);
  }

  async setCamera(on: boolean): Promise<void> {
    if (!this.room) return;
    await this.room.localParticipant.setCameraEnabled(on);
  }

  async setScreenShare(on: boolean): Promise<void> {
    if (!this.room) return;
    await this.room.localParticipant.setScreenShareEnabled(on, {
      audio: true,
      // The system's sound would carry the call back to the others, and this tab its own panel.
      systemAudio: 'exclude',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      contentHint: 'detail',
    });
  }

  screenShare(): boolean {
    // Sharing also ends from the browser's own "Stop sharing" control.
    return !!this.room?.localParticipant.isScreenShareEnabled;
  }

  setSound(on: boolean): void {
    this.sound = on;
    this.audioHost?.querySelectorAll('audio').forEach((element) => {
      // eslint-disable-next-line no-param-reassign
      element.muted = !on;
    });
  }

  async setDevice(kind: CallDeviceKind, deviceId: string): Promise<void> {
    if (!this.room) return;
    await this.room.switchActiveDevice(kind, deviceId);
  }

  audioBlocked(): boolean {
    const room = this.room;
    return !!room && room.state === ConnectionState.Connected && !room.canPlaybackAudio;
  }

  async resumeAudio(): Promise<void> {
    if (!this.room) return;
    await this.room.startAudio();
  }

  microphoneTrack(): MediaStreamTrack | undefined {
    const publication = this.room?.localParticipant.getTrackPublication(Track.Source.Microphone);
    return publication && !publication.isMuted ? publication.track?.mediaStreamTrack : undefined;
  }

  silence(): void {
    this.room?.localParticipant.trackPublications.forEach((publication) => {
      publication.track?.off(TrackEvent.Restarted, this.changed);
    });
    this.audioHost?.remove();
    this.audioHost = undefined;
  }

  async disconnect(): Promise<void> {
    await this.room?.disconnect(true);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = undefined;
  }

  /** LiveKit opens a microphone again in the same track when it ended, with a new media track. */
  private onLocalTrackPublished = (publication: LocalTrackPublication) => {
    publication.track?.on(TrackEvent.Restarted, this.changed);
    this.changed();
  };

  private onLocalTrackUnpublished = (publication: LocalTrackPublication) => {
    publication.track?.off(TrackEvent.Restarted, this.changed);
    this.changed();
  };

  private attachAudio(track: RemoteTrack) {
    // Once: a membership change can find a track before LiveKit reports its subscription.
    if (track.kind !== Track.Kind.Audio || track.attachedElements.length > 0) return;
    if (!this.audioHost) {
      const host = document.createElement('div');
      host.hidden = true;
      host.dataset.callAudio = this.roomId;
      document.body.append(host);
      this.audioHost = host;
    }
    const element = track.attach();
    element.muted = !this.sound;
    this.audioHost.append(element);
  }

  private detachAudio(track: RemoteTrack) {
    track.detach().forEach((element) => element.remove());
  }

  private watch(room: MediaRoom) {
    room
      .on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (this.host.isMember(participant.identity)) this.attachAudio(track);
        this.changed();
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        this.detachAudio(track);
        this.changed();
      })
      .on(RoomEvent.ParticipantConnected, (participant) => {
        this.host.onParticipantConnected(participant.identity);
      })
      .on(RoomEvent.ParticipantDisconnected, this.changed)
      .on(RoomEvent.TrackMuted, this.changed)
      .on(RoomEvent.TrackUnmuted, this.changed)
      .on(RoomEvent.LocalTrackPublished, this.onLocalTrackPublished)
      .on(RoomEvent.LocalTrackUnpublished, this.onLocalTrackUnpublished)
      .on(RoomEvent.ActiveSpeakersChanged, this.changed)
      .on(RoomEvent.AudioPlaybackStatusChanged, this.changed)
      .on(RoomEvent.Reconnecting, () => this.host.onPhase('reconnecting'))
      .on(RoomEvent.Reconnected, () => this.host.onPhase('connected'))
      // The media server dropped this device for good (LiveKit retries before giving up); after
      // a leave or another failure this is the teardown's own disconnect.
      .on(RoomEvent.Disconnected, () => this.host.onDisconnected())
      .on(RoomEvent.ActiveDeviceChanged, (kind, deviceId) => {
        this.host.onDevice(kind, deviceId);
      });
  }
}
