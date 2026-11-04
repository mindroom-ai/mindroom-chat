import {
  ConnectionState,
  isBrowserSupported,
  isE2EESupported,
  Room as MediaRoom,
  RoomEvent,
  Track,
  type LocalVideoTrack,
  type Participant,
  type RemoteTrack,
  type RemoteVideoTrack,
} from 'livekit-client';
import E2EEWorker from 'livekit-client/e2ee-worker?worker';
import { MatrixRTCSessionEvent, type MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { MatrixRtcKeyProvider } from './callKeyProvider';
import { firstLivekitServiceUrl, getLivekitServiceUrl, requestSfuGrant } from './rtcFocus';
import { activeMemberships, membershipIdentity } from './callMemberships';
import { holdDeviceCallLock, withdrawOwnMemberships } from './callResume';

export type CallPhase = 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'failed';

/** Why a call could not start or went on without something. */
export type CallProblem =
  /** No WebRTC, or no frame encryption for an encrypted room. */
  | 'browser'
  /** The deployment announces no LiveKit backend. */
  | 'homeserver'
  /** The backend refused this account or could not be reached. */
  | 'service'
  /** The media connection failed or dropped. */
  | 'connection'
  /** The microphone or camera could not be opened; the call goes on without it. */
  | 'device';

export type CallDeviceKind = 'audioinput' | 'videoinput' | 'audiooutput';
export type CallDevices = Partial<Record<CallDeviceKind, string>>;

export type CallVideoTrack = LocalVideoTrack | RemoteVideoTrack;

/** One device in the call, as a tile shows it. */
export type CallParticipant = {
  /** The media identity, `<user id>:<device id>`. */
  key: string;
  userId: string;
  deviceId: string;
  local: boolean;
  /** Its media is connected; a member whose media is still on the way shows as waiting. */
  connected: boolean;
  speaking: boolean;
  microphone: boolean;
  video?: CallVideoTrack;
  /** The screen (or window, or tab) this device shares. */
  screen?: CallVideoTrack;
};

export type CallState = {
  phase: CallPhase;
  problem?: CallProblem;
  microphone: boolean;
  camera: boolean;
  /** This device shares its screen. */
  screenShare: boolean;
  /** Whether others are heard; off mutes every remote voice on this device. */
  sound: boolean;
  /** The browser blocked playback until the next click. */
  audioBlocked: boolean;
  devices: CallDevices;
  participants: CallParticipant[];
};

export type RoomCallOptions = {
  mx: MatrixClient;
  room: Room;
  /** Start with the camera on: a video call. */
  video?: boolean;
  microphone?: boolean;
  devices?: CallDevices;
  /** Ring the other people (`ring`, direct chats) or notify them (`notification`). */
  notify?: 'ring' | 'notification';
};

/** How long a leave waits for the membership update before the call is given up locally. */
const LEAVE_TIMEOUT_MS = 5000;
/** How long a join waits for this device's leftover membership to go before joining anyway. */
const LEFTOVER_TIMEOUT_MS = 10_000;

const sameParticipants = (a: CallParticipant[], b: CallParticipant[]) =>
  a.length === b.length &&
  a.every((item, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      item.key === other.key &&
      item.connected === other.connected &&
      item.speaking === other.speaking &&
      item.microphone === other.microphone &&
      item.video === other.video &&
      item.screen === other.screen
    );
  });

/**
 * One call this device takes part in: its MatrixRTC membership in the Matrix room (state
 * events, with media keys over Olm when the room is encrypted) and its LiveKit media connection.
 * React reads it through `subscribe` and `getState`.
 */
export class RoomCall {
  readonly mx: MatrixClient;

  readonly room: Room;

  readonly session: MatrixRTCSession;

  /** Frame encryption is on, as the Matrix room is encrypted. */
  readonly encrypted: boolean;

  private readonly options: RoomCallOptions;

  private state: CallState;

  private readonly listeners = new Set<() => void>();

  private media?: MediaRoom;

  private keyProvider?: MatrixRtcKeyProvider;

  private worker?: Worker;

  private audioHost?: HTMLElement;

  private leaving?: Promise<void>;

  /** Releases the lock that tells this device's other tabs it is in a call. */
  private releaseDeviceLock?: () => void;

  constructor(options: RoomCallOptions) {
    this.options = options;
    this.mx = options.mx;
    this.room = options.room;
    this.session = options.mx.matrixRTC.getRoomSession(options.room);
    this.encrypted = options.room.hasEncryptionStateEvent();
    this.state = {
      phase: 'connecting',
      microphone: options.microphone ?? true,
      camera: options.video ?? false,
      screenShare: false,
      sound: true,
      audioBlocked: false,
      devices: options.devices ?? {},
      participants: [],
    };
    this.state = { ...this.state, participants: this.readParticipants() };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): CallState => this.state;

  get identity(): string {
    return `${this.mx.getSafeUserId()}:${this.mx.getDeviceId() ?? ''}`;
  }

  private update(change: Partial<CallState>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }

  private refresh = () => {
    const participants = this.readParticipants();
    const media = this.media;
    const audioBlocked =
      !!media && media.state === ConnectionState.Connected && !media.canPlaybackAudio;
    // Sharing also ends from the browser's own "Stop sharing" control.
    const screenShare = !!media?.localParticipant.isScreenShareEnabled;
    if (
      sameParticipants(participants, this.state.participants) &&
      audioBlocked === this.state.audioBlocked &&
      screenShare === this.state.screenShare
    ) {
      return;
    }
    this.update({ participants, audioBlocked, screenShare });
  };

  private mediaParticipant(identity: string): Participant | undefined {
    const media = this.media;
    if (!media) return undefined;
    if (identity === this.identity) return media.localParticipant;
    return media.remoteParticipants.get(identity);
  }

  /** This device first, then the call's other devices by the time they joined. */
  private readParticipants(): CallParticipant[] {
    const describe = (userId: string, deviceId: string, key: string): CallParticipant => {
      const local = key === this.identity;
      const participant = this.mediaParticipant(key);
      const shown = (source: Track.Source) => {
        const publication = participant?.getTrackPublication(source);
        return publication && !publication.isMuted
          ? (publication.track as CallVideoTrack | undefined)
          : undefined;
      };
      return {
        key,
        userId,
        deviceId,
        local,
        connected: local ? this.media?.state === ConnectionState.Connected : !!participant,
        speaking: !!participant?.isSpeaking,
        microphone: local ? this.state.microphone : !!participant?.isMicrophoneEnabled,
        video: shown(Track.Source.Camera),
        screen: shown(Track.Source.ScreenShare),
      };
    };
    const others = activeMemberships(this.session)
      .map((membership) => ({ ...membership, key: membershipIdentity(membership) }))
      .filter(({ key }) => key !== this.identity)
      .map(({ userId, deviceId, key }) => describe(userId, deviceId, key));
    const deviceId = this.mx.getDeviceId() ?? '';
    return [describe(this.mx.getSafeUserId(), deviceId, this.identity), ...others];
  }

  /** The backend the call already runs on (the oldest membership's), or this deployment's. */
  private async findService(): Promise<string | undefined> {
    const oldest = this.session.getOldestMembership();
    const inUse = oldest ? firstLivekitServiceUrl(oldest.transports) : undefined;
    return inUse ?? getLivekitServiceUrl(this.mx);
  }

  private attachAudio(track: RemoteTrack) {
    if (track.kind !== Track.Kind.Audio) return;
    if (!this.audioHost) {
      const host = document.createElement('div');
      host.hidden = true;
      host.dataset.callAudio = this.room.roomId;
      document.body.append(host);
      this.audioHost = host;
    }
    const element = track.attach();
    element.muted = !this.state.sound;
    this.audioHost.append(element);
  }

  private detachAudio(track: RemoteTrack) {
    track.detach().forEach((element) => element.remove());
  }

  private watchMedia(media: MediaRoom) {
    media
      .on(RoomEvent.TrackSubscribed, (track) => {
        this.attachAudio(track);
        this.refresh();
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        this.detachAudio(track);
        this.refresh();
      })
      .on(RoomEvent.ParticipantConnected, this.refresh)
      .on(RoomEvent.ParticipantDisconnected, this.refresh)
      .on(RoomEvent.TrackMuted, this.refresh)
      .on(RoomEvent.TrackUnmuted, this.refresh)
      .on(RoomEvent.LocalTrackPublished, this.refresh)
      .on(RoomEvent.LocalTrackUnpublished, this.refresh)
      .on(RoomEvent.ActiveSpeakersChanged, this.refresh)
      .on(RoomEvent.AudioPlaybackStatusChanged, this.refresh)
      .on(RoomEvent.Reconnecting, () => this.update({ phase: 'reconnecting' }))
      .on(RoomEvent.Reconnected, () => this.update({ phase: 'connected' }))
      .on(RoomEvent.Disconnected, () => {
        if (this.leaving || this.state.phase === 'ended' || this.state.phase === 'failed') return;
        // The media server dropped this device for good (LiveKit retries before giving up).
        this.fail('connection');
      })
      .on(RoomEvent.ActiveDeviceChanged, (kind, deviceId) => {
        this.update({ devices: { ...this.state.devices, [kind]: deviceId } });
      });
  }

  private onMemberships = () => this.refresh();

  private onKey = (
    key: Uint8Array,
    keyIndex: number,
    _membership: unknown,
    participantIdentity: string
  ) => {
    this.keyProvider?.setParticipantKey(key, keyIndex, participantIdentity).catch(() => undefined);
  };

  private onMembershipError = () => {
    if (!this.leaving) this.fail('connection');
  };

  private fail(problem: CallProblem) {
    this.update({ phase: 'failed', problem });
    this.teardown().catch(() => undefined);
  }

  /**
   * Withdraws the membership this device still has in the call from an earlier page (a reload,
   * or a tab that crashed) and waits until the session no longer lists it. Joining over it would
   * send the same membership again (the SDK keeps its creation time), which nobody sees as a
   * join, so no media keys would be exchanged.
   */
  private async withdrawLeftover(deviceId: string): Promise<void> {
    const userId = this.mx.getSafeUserId();
    const listed = () =>
      this.session.memberships.some(
        (membership) => membership.userId === userId && membership.deviceId === deviceId
      );
    if (!listed()) return;
    await withdrawOwnMemberships(this.mx, [this.room]);
    await new Promise<void>((resolve) => {
      let timer = 0;
      const check = () => {
        if (listed()) return;
        window.clearTimeout(timer);
        this.session.off(MatrixRTCSessionEvent.MembershipsChanged, check);
        resolve();
      };
      timer = window.setTimeout(() => {
        this.session.off(MatrixRTCSessionEvent.MembershipsChanged, check);
        resolve();
      }, LEFTOVER_TIMEOUT_MS);
      this.session.on(MatrixRTCSessionEvent.MembershipsChanged, check);
      check();
    });
  }

  /** Joins the call: media connection first, then the membership others see, then the devices. */
  async join(): Promise<void> {
    const { mx, room } = this;
    const deviceId = mx.getDeviceId();
    if (!isBrowserSupported() || (this.encrypted && !isE2EESupported()) || !deviceId) {
      this.update({ phase: 'failed', problem: 'browser' });
      return;
    }
    this.session.on(MatrixRTCSessionEvent.MembershipsChanged, this.onMemberships);
    this.session.on(MatrixRTCSessionEvent.EncryptionKeyChanged, this.onKey);
    this.session.on(MatrixRTCSessionEvent.MembershipManagerError, this.onMembershipError);
    this.releaseDeviceLock = holdDeviceCallLock(mx);
    await this.withdrawLeftover(deviceId);
    if (this.leaving) return;

    const serviceUrl = await this.findService();
    if (this.leaving) return;
    if (!serviceUrl) {
      this.fail('homeserver');
      return;
    }

    let media: MediaRoom;
    try {
      const token = await mx.getOpenIdToken();
      const grant = await requestSfuGrant(serviceUrl, { roomId: room.roomId, deviceId, token });
      if (this.leaving) return;
      if (this.encrypted) {
        this.keyProvider = new MatrixRtcKeyProvider();
        this.worker = new E2EEWorker();
      }
      media = new MediaRoom({
        adaptiveStream: true,
        dynacast: true,
        // The call's lifetime leaves on `pagehide` after remembering the call for a reload; left to
        // itself, LiveKit drops the call already on `beforeunload`, and the reload finds it failed.
        disconnectOnPageLeave: false,
        audioCaptureDefaults: { deviceId: this.state.devices.audioinput },
        videoCaptureDefaults: { deviceId: this.state.devices.videoinput },
        audioOutput: { deviceId: this.state.devices.audiooutput },
        ...(this.keyProvider && this.worker
          ? { encryption: { keyProvider: this.keyProvider, worker: this.worker } }
          : {}),
      });
      this.media = media;
      this.watchMedia(media);
      if (this.encrypted) await media.setE2EEEnabled(true);
      await media.connect(grant.url, grant.jwt);
    } catch {
      if (!this.leaving) this.fail('service');
      return;
    }
    if (this.leaving) return;

    // Announce the membership; the session shares this device's media key with the others.
    this.session.joinRTCSession(
      { userId: mx.getSafeUserId(), deviceId, memberId: this.identity },
      [{ type: 'livekit', livekit_service_url: serviceUrl, livekit_alias: room.roomId }],
      undefined,
      {
        manageMediaKeys: this.encrypted,
        callIntent: this.state.camera ? 'video' : 'audio',
        notificationType: this.options.notify,
      }
    );
    this.update({ phase: 'connected' });

    let problem: CallProblem | undefined;
    await media.localParticipant.setMicrophoneEnabled(this.state.microphone).catch(() => {
      problem = 'device';
      this.update({ microphone: false });
    });
    if (this.state.camera) {
      await media.localParticipant.setCameraEnabled(true).catch(() => {
        problem = 'device';
        this.update({ camera: false });
      });
    }
    this.update({ problem });
    this.refresh();
  }

  async setMicrophone(on: boolean) {
    this.update({ microphone: on });
    const participant = this.media?.localParticipant;
    if (!participant || this.state.phase === 'connecting') return;
    await participant.setMicrophoneEnabled(on).catch(() => {
      this.update({ microphone: false, problem: 'device' });
    });
    this.refresh();
  }

  async setCamera(on: boolean) {
    this.update({ camera: on });
    const participant = this.media?.localParticipant;
    if (!participant || this.state.phase === 'connecting') return;
    await participant.setCameraEnabled(on).catch(() => {
      this.update({ camera: false, problem: 'device' });
    });
    this.refresh();
  }

  /**
   * Starts or stops sharing a screen, window or tab the person picks (with the tab's sound where
   * the browser offers it). Closing the browser's picker leaves sharing off without a problem.
   */
  async setScreenShare(on: boolean) {
    const participant = this.media?.localParticipant;
    if (!participant || this.state.phase === 'connecting') return;
    await participant
      .setScreenShareEnabled(on, {
        audio: true,
        // The system's sound would carry the call back to the others, and this tab its own panel.
        systemAudio: 'exclude',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        contentHint: 'detail',
      })
      .catch(() => undefined);
    this.refresh();
  }

  setSound(on: boolean) {
    this.audioHost?.querySelectorAll('audio').forEach((element) => {
      // eslint-disable-next-line no-param-reassign
      element.muted = !on;
    });
    this.update({ sound: on });
  }

  async setDevice(kind: CallDeviceKind, deviceId: string) {
    this.update({ devices: { ...this.state.devices, [kind]: deviceId } });
    await this.media?.switchActiveDevice(kind, deviceId).catch(() => {
      this.update({ problem: 'device' });
    });
  }

  /** Plays the others after the browser blocked autoplay; must run inside a click. */
  async resumeAudio() {
    await this.media?.startAudio().catch(() => undefined);
    this.refresh();
  }

  private async teardown() {
    this.session.off(MatrixRTCSessionEvent.MembershipsChanged, this.onMemberships);
    this.session.off(MatrixRTCSessionEvent.EncryptionKeyChanged, this.onKey);
    this.session.off(MatrixRTCSessionEvent.MembershipManagerError, this.onMembershipError);
    const media = this.media;
    this.media = undefined;
    this.audioHost?.remove();
    this.audioHost = undefined;
    try {
      const membership = this.session.isJoined()
        ? this.session.leaveRoomSession(LEAVE_TIMEOUT_MS)
        : undefined;
      // LiveKit's disconnect rejects when its leave message cannot go out; the call is over anyway.
      await Promise.allSettled([media?.disconnect(true), membership]);
    } finally {
      // Kept past a failed disconnect: a lock left held would tell this device's other tabs for
      // the rest of the page's life that it is still in a call.
      this.worker?.terminate();
      this.worker = undefined;
      this.releaseDeviceLock?.();
      this.releaseDeviceLock = undefined;
    }
  }

  /** Leaves the call; resolves once the membership is withdrawn (or the wait timed out). */
  leave(): Promise<void> {
    if (!this.leaving) {
      this.leaving = this.teardown().finally(() => {
        if (this.state.phase !== 'failed') this.update({ phase: 'ended' });
      });
    }
    return this.leaving;
  }
}
