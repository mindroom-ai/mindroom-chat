import {
  ConnectionState,
  isBrowserSupported,
  isE2EESupported,
  Room as MediaRoom,
  RoomEvent,
  Track,
  TrackEvent,
  type LocalTrackPublication,
  type LocalVideoTrack,
  type Participant,
  type RemoteTrack,
  type RemoteVideoTrack,
} from 'livekit-client';
import E2EEWorker from 'livekit-client/e2ee-worker?worker';
import { MatrixRTCSessionEvent, type MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { MatrixRtcKeyProvider, sendCallKey } from './callKeyProvider';
import {
  chooseCallService,
  firstLivekitServiceUrl,
  getLivekitServiceUrl,
  requestSfuGrant,
  type OwnSfuGrant,
  type SfuGrant,
} from './rtcFocus';
import { activeMemberships, membershipIdentity } from './callMemberships';
import { withdrawOwnMemberships } from './callResume';

export type CallPhase = 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'failed';

/** Why a call could not start or went on without something. */
export type CallProblem =
  /** No WebRTC, or no frame encryption for an encrypted room. */
  | 'browser'
  /** The deployment announces no LiveKit backend. */
  | 'homeserver'
  /** The call runs on a LiveKit backend the deployment does not announce. */
  | 'untrustedService'
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
  /**
   * The microphone this device publishes to the call, while it is on. A switched microphone (or
   * one opened again) is a new track.
   */
  microphoneTrack?: MediaStreamTrack;
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
  /**
   * Lets go of the lock that tells this device's other tabs it is in a call (`takeDeviceCallLock`,
   * taken before the call starts). The call runs it once it has left.
   */
  releaseDeviceLock?: () => void;
  /**
   * A grant of the deployment's own call service asked for while the call was being prepared
   * (`requestOwnSfuGrant`), undefined when it could not be had; the join asks again then, and
   * when it is for another service.
   */
  grant?: Promise<OwnSfuGrant | undefined>;
};

/** Who this device joins a call as, as the session takes it and hands it back with its own keys. */
type OwnMembership = { userId: string; deviceId: string; memberId: string };

/** How long a leave waits for the membership update before the call is given up locally. */
const LEAVE_TIMEOUT_MS = 5000;
/** How long a join waits for this device's leftover membership to go before joining anyway. */
const LEFTOVER_TIMEOUT_MS = 10_000;
/** When sending this device's media key to one device again fails, the waits before the next tries. */
const KEY_RESEND_RETRY_MS = [1_000, 3_000];

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

  /** The identity this call joined the session with; its own keys come back with it. */
  private ownMembership?: OwnMembership;

  /** This device's current media key in the call, as the session made it. */
  private ownKey?: { key: Uint8Array; index: number };

  /**
   * The other devices (media identities) this device sends its own key to again: those whose
   * first key reached this device or whose media joined (`resendOwnKey`).
   */
  private readonly keyPeers = new Set<string>();

  /** `<media identity> <membership time> <own key index>` of every key sent again, or on its way. */
  private readonly keysResent = new Set<string>();

  /** Failed sends of the own key, by the same keys as `keysResent`. */
  private readonly keyResendFailures = new Map<string, number>();

  constructor(options: RoomCallOptions) {
    this.options = options;
    this.releaseDeviceLock = options.releaseDeviceLock;
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
    const microphoneTrack = this.readMicrophoneTrack();
    if (
      sameParticipants(participants, this.state.participants) &&
      audioBlocked === this.state.audioBlocked &&
      screenShare === this.state.screenShare &&
      microphoneTrack === this.state.microphoneTrack
    ) {
      return;
    }
    this.update({ participants, audioBlocked, screenShare, microphoneTrack });
  };

  /** The media track of the microphone this device publishes, unless it is muted. */
  private readMicrophoneTrack(): MediaStreamTrack | undefined {
    const publication = this.media?.localParticipant.getTrackPublication(Track.Source.Microphone);
    return publication && !publication.isMuted ? publication.track?.mediaStreamTrack : undefined;
  }

  /** LiveKit opens a microphone again in the same track when it ended, with a new media track. */
  private onLocalTrackPublished = (publication: LocalTrackPublication) => {
    publication.track?.on(TrackEvent.Restarted, this.refresh);
    this.refresh();
  };

  private onLocalTrackUnpublished = (publication: LocalTrackPublication) => {
    publication.track?.off(TrackEvent.Restarted, this.refresh);
    this.refresh();
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

  /** The media identities of the call's members, as their tiles show them. */
  private memberIdentities(): Set<string> {
    return new Set(activeMemberships(this.session).map(membershipIdentity));
  }

  /**
   * Plays the sound of the call's members only, and lets only them receive this device's tracks:
   * a device on the media server that is not (or no longer, or not yet) a member is neither heard
   * nor sent anything.
   */
  private followMembers() {
    const media = this.media;
    if (!media) return;
    const members = this.memberIdentities();
    // Kept by LiveKit and sent again after a reconnect.
    media.localParticipant.setTrackSubscriptionPermissions(
      false,
      [...members].map((participantIdentity) => ({ participantIdentity, allowAll: true }))
    );
    media.remoteParticipants.forEach((participant) => {
      const member = members.has(participant.identity);
      participant.audioTrackPublications.forEach(({ track }) => {
        if (!track) return;
        if (!member) this.detachAudio(track);
        else if (track.attachedElements.length === 0) this.attachAudio(track);
      });
    });
  }

  private watchMedia(media: MediaRoom) {
    media
      .on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (this.memberIdentities().has(participant.identity)) this.attachAudio(track);
        this.refresh();
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        this.detachAudio(track);
        this.refresh();
      })
      .on(RoomEvent.ParticipantConnected, (participant) => {
        this.keyPeers.add(participant.identity);
        this.resendOwnKey();
        this.refresh();
      })
      .on(RoomEvent.ParticipantDisconnected, this.refresh)
      .on(RoomEvent.TrackMuted, this.refresh)
      .on(RoomEvent.TrackUnmuted, this.refresh)
      .on(RoomEvent.LocalTrackPublished, this.onLocalTrackPublished)
      .on(RoomEvent.LocalTrackUnpublished, this.onLocalTrackUnpublished)
      .on(RoomEvent.ActiveSpeakersChanged, this.refresh)
      .on(RoomEvent.AudioPlaybackStatusChanged, this.refresh)
      .on(RoomEvent.Reconnecting, () => this.update({ phase: 'reconnecting' }))
      .on(RoomEvent.Reconnected, () => this.update({ phase: 'connected' }))
      // The media server dropped this device for good (LiveKit retries before giving up); after
      // a leave or another failure this is the teardown's own disconnect.
      .on(RoomEvent.Disconnected, () => this.fail('connection'))
      .on(RoomEvent.ActiveDeviceChanged, (kind, deviceId) => {
        this.update({ devices: { ...this.state.devices, [kind]: deviceId } });
        // A switched microphone is a new media track.
        this.refresh();
      });
  }

  private onMemberships = () => {
    this.followMembers();
    this.refresh();
    this.resendOwnKey();
  };

  private onKey = (
    key: Uint8Array,
    keyIndex: number,
    membership: unknown,
    participantIdentity: string
  ) => {
    if (participantIdentity === this.identity) {
      // A left call's key manager stays with the room's session until the next join replaces it,
      // and goes on making keys for this device: only this call's own keys encrypt its media.
      if (!this.ownMembership || membership !== this.ownMembership) return;
      this.ownKey = { key, index: keyIndex };
    } else {
      this.keyPeers.add(participantIdentity);
    }
    this.keyProvider?.setParticipantKey(key, keyIndex, participantIdentity).catch(() => undefined);
    this.resendOwnKey();
  };

  /**
   * Sends this device's current media key once more to each device whose first key reached this
   * device or whose media joined. The session sends it when their membership arrives, but gives up
   * for good when that send fails (an Olm session it cannot make, a store error): the key counts
   * as shared, and the other side never hears this device. Their key arriving here shows an Olm
   * session that works, so the key goes again then, once per membership and own key index; a send
   * that fails is tried twice more.
   */
  private resendOwnKey() {
    const own = this.ownKey;
    if (!own || !this.encrypted || this.stopped) return;
    const members = activeMemberships(this.session);
    this.keyPeers.forEach((identity) => {
      const member = members.find((candidate) => membershipIdentity(candidate) === identity);
      if (!member) return;
      // A device that joins again (a new membership) gets the key again.
      const sent = `${identity} ${member.createdTs} ${own.index}`;
      if (this.keysResent.has(sent)) return;
      this.keysResent.add(sent);
      sendCallKey(this.mx, {
        roomId: this.room.roomId,
        key: own.key,
        keyIndex: own.index,
        memberId: this.identity,
        to: member,
      }).catch(() => {
        const failures = (this.keyResendFailures.get(sent) ?? 0) + 1;
        this.keyResendFailures.set(sent, failures);
        const wait = KEY_RESEND_RETRY_MS[failures - 1];
        if (wait === undefined) return;
        window.setTimeout(() => {
          this.keysResent.delete(sent);
          this.resendOwnKey();
        }, wait);
      });
    });
  }

  private onMembershipError = () => this.fail('connection');

  /** Left, or given up: a join still on its way stops at its next step. */
  private get stopped(): boolean {
    return this.leaving !== undefined || this.state.phase === 'failed';
  }

  /**
   * Gives the call up with the problem the panel shows, and lets go of everything it holds. The
   * first problem stays: a connection that dropped while connecting also fails the connect.
   */
  fail(problem: CallProblem) {
    if (this.stopped) return;
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

  /** A grant for the call service: the one asked for while preparing, or a new one. */
  private async grantFor(serviceUrl: string, deviceId: string): Promise<SfuGrant> {
    const early = await this.options.grant;
    if (early?.serviceUrl === serviceUrl) return early.grant;
    const token = await this.mx.getOpenIdToken();
    return requestSfuGrant(serviceUrl, { roomId: this.room.roomId, deviceId, token });
  }

  /**
   * Joins the call: once the call service grants it, the membership others see, with the media
   * connection on its way meanwhile; then the devices. Announcing first lets the others (a
   * MindRoom agent too) start joining while this device connects, instead of after it.
   */
  async join(): Promise<void> {
    const { mx, room } = this;
    const deviceId = mx.getDeviceId();
    if (!isBrowserSupported() || (this.encrypted && !isE2EESupported()) || !deviceId) {
      this.fail('browser');
      return;
    }
    this.session.on(MatrixRTCSessionEvent.MembershipsChanged, this.onMemberships);
    this.session.on(MatrixRTCSessionEvent.EncryptionKeyChanged, this.onKey);
    this.session.on(MatrixRTCSessionEvent.MembershipManagerError, this.onMembershipError);
    await this.withdrawLeftover(deviceId);
    if (this.stopped) return;

    // Only this deployment's backend: a call on one a room member named is refused (rtcFocus.ts).
    const ownService = await getLivekitServiceUrl(mx);
    const oldest = this.session.getOldestMembership();
    const service = chooseCallService(
      oldest ? firstLivekitServiceUrl(oldest.transports) : undefined,
      ownService
    );
    if (this.stopped) return;
    if ('refused' in service) {
      this.fail(service.refused === 'foreign' ? 'untrustedService' : 'homeserver');
      return;
    }
    const serviceUrl = service.url;

    let grant: SfuGrant;
    try {
      grant = await this.grantFor(serviceUrl, deviceId);
    } catch {
      this.fail('service');
      return;
    }
    if (this.stopped) return;

    // The session hands over the media keys from the moment it joins; LiveKit takes the ones that
    // came before its connection when it connects.
    if (this.encrypted) this.keyProvider = new MatrixRtcKeyProvider();
    try {
      // Announce the membership; the session shares this device's media key with the others.
      this.ownMembership = { userId: mx.getSafeUserId(), deviceId, memberId: this.identity };
      this.session.joinRTCSession(
        this.ownMembership,
        [{ type: 'livekit', livekit_service_url: serviceUrl, livekit_alias: room.roomId }],
        undefined,
        {
          manageMediaKeys: this.encrypted,
          callIntent: this.state.camera ? 'video' : 'audio',
          notificationType: this.options.notify,
        }
      );
    } catch {
      // The SDK refuses a membership it cannot make at once; the panel offers Dismiss.
      this.fail('service');
      return;
    }

    let media: MediaRoom;
    try {
      if (this.keyProvider) this.worker = new E2EEWorker();
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
      // The teardown of a call left meanwhile disconnected this room already; it stays so.
      if (this.stopped) return;
      await media.connect(grant.url, grant.jwt);
    } catch {
      this.fail('service');
      return;
    }
    if (this.stopped) {
      // Left or dropped while connecting: a connect that still went through is closed again.
      await media.disconnect(true).catch(() => undefined);
      return;
    }
    this.update({ phase: 'connected' });
    // Before this device publishes anything.
    this.followMembers();
    // LiveKit takes up the keys set before it connected with the newest index of any member as
    // current; this device's own key is set again so its media goes out with that one.
    const own = this.ownKey;
    if (own) {
      this.keyProvider?.setParticipantKey(own.key, own.index, this.identity).catch(() => undefined);
    }

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
    if (this.stopped) return;
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
    this.refresh();
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
    media?.localParticipant.trackPublications.forEach((publication) => {
      publication.track?.off(TrackEvent.Restarted, this.refresh);
    });
    if (this.state.microphoneTrack) this.update({ microphoneTrack: undefined });
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
