import {
  ConnectionState,
  DisconnectReason,
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
  type RoomEventCallbacks,
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
import { RESUME_WINDOW_MS, withdrawOwnMemberships } from './callResume';
import type { CallNotifyInputs } from './callRings';
import { startCallRingTrace } from './callRingTrace';
import { screenShareIsInAppOnly } from './callSupport';

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
  /** An input could not be opened, or a device selection failed; the call goes on. */
  | 'device';

export type CallDeviceKind = 'audioinput' | 'videoinput' | 'audiooutput';
export type CallDevices = Partial<Record<CallDeviceKind, string>>;

type InputKind = 'microphone' | 'camera';

const unmutedInputTrack = (publication: LocalTrackPublication | undefined) =>
  publication && !publication.isMuted ? publication.track?.mediaStreamTrack : undefined;

const isLiveInputTrack = (track: MediaStreamTrack | undefined) =>
  track?.readyState === 'live' && track.muted === false;

const isPageHidden = () => document.visibilityState === 'hidden';

/** The reasons of a drop for a lost connection; with any other, the media server meant it. */
const CONNECTION_LOST: ReadonlySet<DisconnectReason | undefined> = new Set([
  undefined,
  DisconnectReason.UNKNOWN_REASON,
  DisconnectReason.SERVER_SHUTDOWN,
  DisconnectReason.STATE_MISMATCH,
  DisconnectReason.JOIN_FAILURE,
  DisconnectReason.MIGRATION,
  DisconnectReason.SIGNAL_CLOSE,
  DisconnectReason.CONNECTION_TIMEOUT,
  DisconnectReason.MEDIA_FAILURE,
]);

/**
 * A rejoin after the media dropped in the background, from the drop until its media connects:
 * `timer` fails the call at `deadline`, `left` tells whether the old membership was withdrawn.
 */
type Rejoin = { deadline: number; timer: number; left: Promise<boolean> };

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
  /** Screen sharing was stopped when an in-app-only platform (iOS) went to the background. */
  screenShareStoppedInBackground?: boolean;
  /** Local microphone track ended without user action and has not recovered (nor been dismissed). */
  microphoneStopped?: boolean;
  /** Local camera track ended without user action and has not recovered (nor been dismissed). */
  cameraStopped?: boolean;
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
  /** Ring the other people (`ring`, direct chats or small rooms) or notify them (`notification`). */
  notify?: 'ring' | 'notification';
  /** Inputs that produced `notify`, recorded in the join's ring trace. */
  notifyInputs?: CallNotifyInputs;
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
/** How long after the page shows again a drop still counts as one of its time in the background. */
const BACKGROUND_DROP_MS = 60_000;
/** When sending this device's media key to one device again fails, the waits before the next tries. */
const KEY_RESEND_RETRY_MS = [1_000, 3_000];
/**
 * How long the others are rung or notified of the call (the `lifetime` of its notification event);
 * the SDK's own default is ninety seconds.
 */
const RING_LIFETIME_MS = 30_000;

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

  private readonly captureFailures = new Set<InputKind>();

  /** Inputs whose track ended without user action, and whether the warning notice is still shown. */
  private readonly stoppedInputs = new Map<InputKind, 'shown' | 'dismissed'>();

  private readonly selectionFailures = new Set<CallDeviceKind>();

  private readonly requestedInputs: Record<InputKind, boolean>;

  private readonly inputTracks: Partial<Record<InputKind, MediaStreamTrack>> = {};

  private readonly unmutedInputs: Partial<Record<InputKind, MediaStreamTrack>> = {};

  /** A screen-share start in flight; `hid` records if an in-app-only page hid before it settled. */
  private screenShareStart?: { hid: boolean };

  /** The share the background stop mutes and then unpublishes, until it is gone. */
  private retiringShare?: LocalTrackPublication;

  private readonly toggleOps: Record<InputKind, number> = { microphone: 0, camera: 0 };

  private readonly switchOps: Record<CallDeviceKind, number> = {
    audioinput: 0,
    videoinput: 0,
    audiooutput: 0,
  };

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
  private stopRingTrace?: () => void;

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

  /** Whether LiveKit connected at least once; drops before that fail as a join failure. */
  private hasConnected = false;

  /** When the page last came back from the background, since LiveKit last connected. */
  private shownAt = 0;

  /** The rejoin under way, until its media connects or the call stops. */
  private rejoin?: Rejoin;

  /** Wake the steps that wait until the page shows (`shown`). */
  private readonly shownWaiters = new Set<() => void>();

  /** Ends the wait for a leftover membership to go (`withdrawLeftover`); the teardown runs it. */
  private endLeftoverWait?: () => void;

  constructor(options: RoomCallOptions) {
    this.options = options;
    this.releaseDeviceLock = options.releaseDeviceLock;
    this.mx = options.mx;
    this.room = options.room;
    this.session = options.mx.matrixRTC.getRoomSession(options.room);
    this.encrypted = options.room.hasEncryptionStateEvent();
    this.requestedInputs = {
      microphone: options.microphone ?? true,
      camera: options.video ?? false,
    };
    this.state = {
      phase: 'connecting',
      ...this.requestedInputs,
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

  /** A rejected mute can still show On, but a reload must honor the requested Off. */
  getResumeInputs() {
    return {
      microphone: this.state.microphone && this.requestedInputs.microphone,
      camera: this.state.camera && this.requestedInputs.camera,
    };
  }

  get identity(): string {
    return `${this.mx.getSafeUserId()}:${this.mx.getDeviceId() ?? ''}`;
  }

  private update(change: Partial<CallState>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }

  private refresh = () => {
    void this.refreshState();
  };

  private refreshState(reapplyOff?: InputKind): Promise<void> | undefined {
    if (this.stopped) return undefined;
    const mic = this.refreshInput('microphone', reapplyOff === 'microphone');
    const cam = this.refreshInput('camera', reapplyOff === 'camera');
    const microphone = mic.enabled;
    const camera = cam.enabled;
    let { problem } = this.state;
    if (problem === undefined || problem === 'device') {
      problem = this.captureFailures.size || this.selectionFailures.size ? 'device' : undefined;
    }
    const participants = this.readParticipants(microphone);
    const media = this.media;
    const audioBlocked =
      !!media && media.state === ConnectionState.Connected && !media.canPlaybackAudio;
    // Sharing also ends from the browser's own "Stop sharing" control.
    // Nor is a share on that the background stop is still letting go of.
    const share = media?.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    const screenShare =
      !!media?.localParticipant.isScreenShareEnabled && !(share && share === this.retiringShare);
    const microphoneStopped = this.stoppedInputs.get('microphone') === 'shown';
    const cameraStopped = this.stoppedInputs.get('camera') === 'shown';
    const microphoneTrack = this.readMicrophoneTrack();
    if (
      !sameParticipants(participants, this.state.participants) ||
      audioBlocked !== this.state.audioBlocked ||
      screenShare !== this.state.screenShare ||
      microphoneStopped !== !!this.state.microphoneStopped ||
      cameraStopped !== !!this.state.cameraStopped ||
      microphoneTrack !== this.state.microphoneTrack ||
      microphone !== this.state.microphone ||
      camera !== this.state.camera ||
      problem !== this.state.problem
    ) {
      this.update({
        participants,
        audioBlocked,
        screenShare,
        microphoneStopped,
        cameraStopped,
        microphoneTrack,
        microphone,
        camera,
        problem,
      });
    }
    if (reapplyOff === undefined) return undefined;
    return reapplyOff === 'microphone' ? mic.muting : cam.muting;
  }

  private readonly inputEndedHandlers: Record<InputKind, () => void> = {
    microphone: () => this.onInputTrackEnded('microphone'),
    camera: () => this.onInputTrackEnded('camera'),
  };

  private onInputTrackEnded(kind: InputKind) {
    if (this.stopped || this.rejoin || !this.requestedInputs[kind]) return;
    this.stoppedInputs.set(kind, 'shown');
    this.refresh();
  }

  private watchInputTrack(kind: InputKind, track?: MediaStreamTrack) {
    const previous = this.inputTracks[kind];
    if (previous === track) return;
    previous?.removeEventListener('mute', this.refresh);
    previous?.removeEventListener('unmute', this.refresh);
    previous?.removeEventListener('ended', this.inputEndedHandlers[kind]);
    this.inputTracks[kind] = track;
    this.unmutedInputs[kind] = undefined;
    track?.addEventListener('mute', this.refresh);
    track?.addEventListener('unmute', this.refresh);
    track?.addEventListener('ended', this.inputEndedHandlers[kind]);
  }

  private refreshInput(
    kind: InputKind,
    reapplyOff: boolean
  ): {
    enabled: boolean;
    muting?: Promise<void>;
  } {
    const publication = this.inputPublication(kind);
    this.watchInputTrack(kind, publication?.track?.mediaStreamTrack);
    const track = unmutedInputTrack(publication);
    const previous = this.unmutedInputs[kind];
    this.unmutedInputs[kind] = track;
    if (track && isLiveInputTrack(track)) {
      this.captureFailures.delete(kind);
      this.stoppedInputs.delete(kind);
    }
    if (this.stoppedInputs.has(kind)) return { enabled: false };
    if (!publication || !track) return { enabled: this.state[kind] };
    if (this.requestedInputs[kind]) return { enabled: true };
    // A normal mute already owns a known SDK-unmuted track, even while the OS mutes it.
    if (previous === track && !reapplyOff) return { enabled: this.state[kind] };
    const op = this.toggleOps[kind];
    const muting = publication.mute().then(this.refresh, () => {
      if (
        !this.stopped &&
        op === this.toggleOps[kind] &&
        this.inputPublication(kind) === publication &&
        unmutedInputTrack(publication) === track
      ) {
        // Keep the mute action available if LiveKit is still unmuted.
        this.update({ [kind]: true });
        this.refresh();
      }
    });
    return { enabled: false, muting };
  }

  /** The media track of the microphone this device publishes, unless it is muted. */
  private readMicrophoneTrack(): MediaStreamTrack | undefined {
    if (this.stoppedInputs.has('microphone')) return undefined;
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
  private readParticipants(microphone = this.state.microphone): CallParticipant[] {
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
        microphone: local ? microphone : !!participant?.isMicrophoneEnabled,
        video: local && this.stoppedInputs.has('camera') ? undefined : shown(Track.Source.Camera),
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
    // Once: a membership change can find a track before LiveKit reports its subscription.
    if (track.kind !== Track.Kind.Audio || track.attachedElements.length > 0) return;
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
        if (member) this.attachAudio(track);
        else this.detachAudio(track);
      });
    });
  }

  /** This call's handlers of its media room's events; LiveKit has its own on the room. */
  private readonly mediaHandlers = {
    [RoomEvent.TrackSubscribed]: (track, _publication, participant) => {
      if (this.memberIdentities().has(participant.identity)) this.attachAudio(track);
      this.refresh();
    },
    [RoomEvent.TrackUnsubscribed]: (track) => {
      this.detachAudio(track);
      // LiveKit 2.24.1 emits TrackUnsubscribed before clearing `publication.track`.
      queueMicrotask(this.refresh);
    },
    [RoomEvent.ParticipantConnected]: (participant) => {
      this.keyPeers.add(participant.identity);
      this.resendOwnKey();
      this.refresh();
    },
    [RoomEvent.ParticipantDisconnected]: this.refresh,
    [RoomEvent.TrackMuted]: this.refresh,
    [RoomEvent.TrackUnmuted]: this.refresh,
    [RoomEvent.LocalTrackPublished]: this.onLocalTrackPublished,
    [RoomEvent.LocalTrackUnpublished]: this.onLocalTrackUnpublished,
    [RoomEvent.ActiveSpeakersChanged]: this.refresh,
    [RoomEvent.AudioPlaybackStatusChanged]: this.refresh,
    [RoomEvent.Reconnecting]: () => this.update({ phase: 'reconnecting' }),
    [RoomEvent.Reconnected]: () => {
      if (this.stopped) return;
      this.shownAt = 0;
      this.update({ phase: 'connected' });
      this.refresh();
    },
    // The media server dropped this device for good (LiveKit retries before giving up); after
    // a leave or another failure this is the teardown's own disconnect.
    [RoomEvent.Disconnected]: (reason) => this.onMediaDisconnected(reason),
    [RoomEvent.ActiveDeviceChanged]: (kind, deviceId) => {
      this.update({ devices: { ...this.state.devices, [kind]: deviceId } });
      // A switched microphone is a new media track.
      this.refresh();
    },
  } satisfies Partial<RoomEventCallbacks>;

  private watchMedia(media: MediaRoom, method: 'on' | 'off') {
    Object.entries(this.mediaHandlers).forEach(([event, handler]) =>
      media[method](event as keyof RoomEventCallbacks, handler)
    );
  }

  private wakeShownWaiters() {
    this.shownWaiters.forEach((wake) => wake());
    this.shownWaiters.clear();
  }

  /**
   * Resolves once the page shows, with whether `owner` (a rejoin under way, then the media room
   * it connected) is still this call's: a rejoin joins nothing and opens no input in the
   * background, nor after the call stopped or that media dropped.
   */
  private async shown(owner: Rejoin | MediaRoom): Promise<boolean> {
    const current = () => this.rejoin === owner || this.media === owner;
    while (current() && isPageHidden()) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => {
        this.shownWaiters.add(resolve);
      });
    }
    return current();
  }

  private async stopScreenShareInBackground() {
    const media = this.media;
    const participant = media?.localParticipant;
    if (!participant) return;
    const publication = participant.getTrackPublication(Track.Source.ScreenShare);
    this.retiringShare = publication;
    this.update({ screenShare: false, screenShareStoppedInBackground: true });
    // Await mute so LiveKit signals `updateMuteStatus` before unpublish removes its listener.
    await publication?.mute().catch(() => undefined);
    // The share that was on goes, whatever started since; one started since is the person's own.
    const replaced = participant.getTrackPublication(Track.Source.ScreenShare) !== publication;
    if (this.media === media && !(publication && replaced)) await this.setScreenShare(false);
    if (this.retiringShare === publication) this.retiringShare = undefined;
  }

  private onVisibilityChange = () => {
    if (isPageHidden()) {
      // In-app capture (iOS WebKit) sends black frames once the app leaves the foreground.
      if (!this.stopped && !this.rejoin && screenShareIsInAppOnly()) {
        if (this.screenShareStart) {
          this.screenShareStart.hid = true;
        } else if (this.state.screenShare || this.media?.localParticipant.isScreenShareEnabled) {
          void this.stopScreenShareInBackground();
        }
      }
      return;
    }
    this.shownAt = Date.now();
    // The deadline's timer can be late on a page that was suspended.
    if (this.rejoin && this.shownAt >= this.rejoin.deadline) this.fail('connection');
    else this.wakeShownWaiters();
  };

  /**
   * A connection lost by a page that was in the background, where iOS suspends it, does not end
   * the call: it stays `reconnecting`, withdraws its membership, and joins again as a new member
   * once the page shows, within `RESUME_WINDOW_MS` of the drop.
   */
  private onMediaDisconnected = (reason?: DisconnectReason) => {
    if (
      !this.hasConnected ||
      this.rejoin ||
      (!isPageHidden() && Date.now() - this.shownAt > BACKGROUND_DROP_MS) ||
      !CONNECTION_LOST.has(reason)
    ) {
      this.fail('connection');
      return;
    }
    // What this device really had: an input that failed to open stays off.
    Object.assign(this.requestedInputs, this.getResumeInputs());
    const retired = this.detachMedia();
    void retired?.dispose().catch(() => undefined);
    this.worker?.terminate();
    this.worker = undefined;
    this.ownMembership = undefined;
    this.ownKey = undefined;
    this.keyPeers.clear();
    this.keysResent.clear();
    this.keyResendFailures.clear();
    const rejoin: Rejoin = {
      deadline: Date.now() + RESUME_WINDOW_MS,
      timer: window.setTimeout(() => this.fail('connection'), RESUME_WINDOW_MS),
      // The old membership manager must be done first: its retries would clear the new membership.
      left: this.session.isJoined()
        ? this.session.leave(RESUME_WINDOW_MS).catch(() => false)
        : Promise.resolve(true),
    };
    this.rejoin = rejoin;
    this.update({
      phase: 'reconnecting',
      ...this.requestedInputs,
      screenShare: false,
      audioBlocked: false,
      microphoneTrack: undefined,
      participants: this.readParticipants(this.requestedInputs.microphone),
    });
    rejoin.left
      .then(async (left) => {
        const deviceId = this.mx.getDeviceId();
        if (!left || !deviceId) this.fail('connection');
        else if (await this.shown(rejoin)) await this.connectCall(deviceId, rejoin);
      })
      .catch(() => this.fail('connection'));
  };

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
   * join, so no media keys would be exchanged. Resolves with whether it is gone. A rejoin
   * withdrew it with its leave: the session only has to follow, within the rejoin's deadline.
   */
  private async withdrawLeftover(deviceId: string, rejoin?: Rejoin): Promise<boolean> {
    const userId = this.mx.getSafeUserId();
    const listed = () =>
      this.session.memberships.some(
        (membership) => membership.userId === userId && membership.deviceId === deviceId
      );
    if (!listed()) return true;
    if (!rejoin) await withdrawOwnMemberships(this.mx, [this.room]);
    const timeout = rejoin ? rejoin.deadline - Date.now() : LEFTOVER_TIMEOUT_MS;
    await new Promise<void>((resolve) => {
      let timer = 0;
      const check = () => {
        if (!listed()) this.endLeftoverWait?.();
      };
      this.endLeftoverWait = () => {
        window.clearTimeout(timer);
        this.session.off(MatrixRTCSessionEvent.MembershipsChanged, check);
        this.endLeftoverWait = undefined;
        resolve();
      };
      timer = window.setTimeout(this.endLeftoverWait, timeout);
      this.session.on(MatrixRTCSessionEvent.MembershipsChanged, check);
      check();
    });
    return !listed();
  }

  /** A grant for the call service: the one asked for while preparing, or a new one. */
  private async grantFor(serviceUrl: string, deviceId: string, fresh = false): Promise<SfuGrant> {
    const early = fresh ? undefined : await this.options.grant;
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
    const deviceId = this.mx.getDeviceId();
    if (!isBrowserSupported() || (this.encrypted && !isE2EESupported()) || !deviceId) {
      this.fail('browser');
      return;
    }
    this.session.on(MatrixRTCSessionEvent.MembershipsChanged, this.onMemberships);
    this.session.on(MatrixRTCSessionEvent.EncryptionKeyChanged, this.onKey);
    this.session.on(MatrixRTCSessionEvent.MembershipManagerError, this.onMembershipError);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    await this.connectCall(deviceId);
  }

  /** The join, and with `rejoin` the one after a drop: no ring, and it fails as the lost connection. */
  private async connectCall(deviceId: string, rejoin?: Rejoin): Promise<void> {
    const { mx, room } = this;
    const failJoin = (problem: CallProblem) => this.fail(rejoin ? 'connection' : problem);
    const withdrawn = await this.withdrawLeftover(deviceId, rejoin);
    // The first join goes on over a leftover that stays listed; a rejoin never does.
    if (rejoin && !withdrawn) this.fail('connection');
    if (this.stopped) return;

    // Only this deployment's backend: a call on one a room member named is refused (rtcFocus.ts).
    const ownService = await getLivekitServiceUrl(mx);
    const oldest = this.session.memberships[0];
    const service = chooseCallService(
      oldest ? firstLivekitServiceUrl(oldest.transports) : undefined,
      ownService
    );
    if (this.stopped) return;
    if ('refused' in service) {
      failJoin(service.refused === 'foreign' ? 'untrustedService' : 'homeserver');
      return;
    }
    const serviceUrl = service.url;

    let grant: SfuGrant;
    try {
      grant = await this.grantFor(serviceUrl, deviceId, !!rejoin);
    } catch {
      failJoin('service');
      return;
    }
    if (this.stopped) return;
    if (rejoin && !(await this.shown(rejoin))) return;

    // The session hands over the media keys from the moment it joins; LiveKit takes the ones that
    // came before its connection when it connects.
    if (this.encrypted) this.keyProvider = new MatrixRtcKeyProvider();
    try {
      // Announce the membership; the session shares this device's media key with the others.
      this.ownMembership = { userId: mx.getSafeUserId(), deviceId, memberId: this.identity };
      this.stopRingTrace?.();
      this.stopRingTrace = rejoin
        ? undefined
        : startCallRingTrace({
            room,
            session: this.session,
            ownMembership: this.ownMembership,
            encrypted: this.encrypted,
            notify: this.options.notify,
            notifyInputs: this.options.notifyInputs,
          });
      this.session.join(
        this.ownMembership,
        [{ type: 'livekit', livekit_service_url: serviceUrl, livekit_alias: room.roomId }],
        {
          manageMediaKeys: this.encrypted,
          callIntent: this.state.camera ? 'video' : 'audio',
          notificationType: rejoin ? undefined : this.options.notify,
          notificationLifetimeMs: RING_LIFETIME_MS,
        }
      );
    } catch {
      // The SDK refuses a membership it cannot make at once; the panel offers Dismiss.
      failJoin('service');
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
      this.watchMedia(media, 'on');
      if (this.encrypted) await media.setE2EEEnabled(true);
      // The teardown of a call left meanwhile disconnected this room already; it stays so.
      if (this.stopped) return;
      await media.connect(grant.url, grant.jwt);
    } catch {
      failJoin('service');
      return;
    }
    if (this.stopped) {
      // Left or dropped while connecting: a connect that still went through is closed again.
      await media.disconnect(true).catch(() => undefined);
      await media.dispose().catch(() => undefined);
      return;
    }
    // The rejoin is done: the deadline is over, and a drop from here on is the next one's.
    window.clearTimeout(rejoin?.timer);
    this.rejoin = undefined;
    this.hasConnected = true;
    this.shownAt = 0;
    this.update({ phase: 'connected' });
    // Before this device publishes anything.
    this.followMembers();
    // LiveKit takes up the keys set before it connected with the newest index of any member as
    // current; this device's own key is set again so its media goes out with that one.
    const own = this.ownKey;
    if (own) {
      this.keyProvider?.setParticipantKey(own.key, own.index, this.identity).catch(() => undefined);
    }

    const cameraOp = this.toggleOps.camera;
    // A rejoin opens no input in the background, and nothing opens on media that was let go.
    if (rejoin && !(await this.shown(media))) return;
    // Keep a dead-microphone warning across rejoin instead of clearing it with an internal off.
    if (this.requestedInputs.microphone || !this.stoppedInputs.has('microphone')) {
      await this.setMicrophone(this.requestedInputs.microphone);
    }
    if (rejoin ? !(await this.shown(media)) : this.media !== media) return;
    if (this.requestedInputs.camera && cameraOp === this.toggleOps.camera) {
      await this.setCamera(true);
    }
  }

  private inputPublication(kind: InputKind): LocalTrackPublication | undefined {
    const source = kind === 'microphone' ? Track.Source.Microphone : Track.Source.Camera;
    return this.media?.localParticipant.getTrackPublication(source);
  }

  private async setInputEnabled(kind: InputKind, on: boolean) {
    if (this.stopped) return;
    const op = (this.toggleOps[kind] += 1);
    const wasStopped = this.stoppedInputs.delete(kind);
    this.requestedInputs[kind] = on;
    this.update({ [kind]: on, [`${kind}Stopped`]: false });
    const media = this.media;
    if (!media || this.state.phase === 'connecting' || this.rejoin) return;
    // LiveKit's unmute skips track re-acquisition if the publication was never muted when it died.
    if (on && wasStopped) {
      const publication = this.inputPublication(kind);
      if (
        publication &&
        !publication.isMuted &&
        publication.track?.mediaStreamTrack.readyState === 'ended'
      ) {
        await publication.mute().catch(() => undefined);
        if (this.media !== media || op !== this.toggleOps[kind]) return;
      }
    }
    const failed = await (kind === 'microphone'
      ? media.localParticipant.setMicrophoneEnabled(on)
      : media.localParticipant.setCameraEnabled(on)
    ).then(
      () => false,
      () => true
    );
    // The call stopped, or let this media go: its late result says nothing about the inputs.
    if (this.media !== media) return;

    const latest = op === this.toggleOps[kind];
    const track = unmutedInputTrack(this.inputPublication(kind));
    const failedEnable =
      on && (failed || (!isLiveInputTrack(track) && (latest || this.requestedInputs[kind])));
    if (failedEnable) this.captureFailures.add(kind);
    if (latest && (on ? failedEnable && !track : failed && track)) this.update({ [kind]: !on });

    // Only a superseded enable can finish publishing after the user chose Off.
    const reapplyOff = on && !latest && !this.requestedInputs[kind];
    await this.refreshState(reapplyOff ? kind : undefined);
  }

  setMicrophone(on: boolean) {
    return this.setInputEnabled('microphone', on);
  }

  setCamera(on: boolean) {
    return this.setInputEnabled('camera', on);
  }

  /**
   * Starts or stops sharing a screen, window or tab the person picks (with the tab's sound where
   * the browser offers it). Closing the browser's picker leaves sharing off without a problem.
   */
  async setScreenShare(on: boolean) {
    const media = this.media;
    const participant = media?.localParticipant;
    if (!participant || this.state.phase === 'connecting' || this.rejoin) return;
    if (on) {
      // A share the background stop has not let go of yet would only be unmuted, without the
      // picker: LiveKit drops it before its first wait, so the start below finds none.
      if (this.retiringShare) void participant.setScreenShareEnabled(false).catch(() => undefined);
      const start = { hid: false };
      this.screenShareStart = start;
      await participant
        .setScreenShareEnabled(true, {
          audio: true,
          // The system's sound would carry the call back to the others, and this tab its own panel.
          systemAudio: 'exclude',
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
          contentHint: 'detail',
        })
        .catch(() => undefined);
      if (this.screenShareStart === start) this.screenShareStart = undefined;
      if (this.media !== media) return;
      const sharing = participant.isScreenShareEnabled;
      if (start.hid && sharing) return this.stopScreenShareInBackground();
      // The notice stays until a share is on: the picker closed or refused leaves it standing.
      if (sharing) this.dismissScreenShareNotice();
      this.refresh();
      return;
    }
    await participant.setScreenShareEnabled(false).catch(() => undefined);
    this.refresh();
  }

  dismissScreenShareNotice() {
    if (this.state.screenShareStoppedInBackground) {
      this.update({ screenShareStoppedInBackground: false });
    }
  }

  /** Hides the stopped-input notice without changing input intent (auto-recovery still works). */
  dismissStoppedInput(kind: InputKind) {
    if (this.stoppedInputs.get(kind) !== 'shown') return;
    this.stoppedInputs.set(kind, 'dismissed');
    this.update(kind === 'microphone' ? { microphoneStopped: false } : { cameraStopped: false });
  }

  setSound(on: boolean) {
    this.audioHost?.querySelectorAll('audio').forEach((element) => {
      // eslint-disable-next-line no-param-reassign
      element.muted = !on;
    });
    this.update({ sound: on });
  }

  async setDevice(kind: CallDeviceKind, deviceId: string) {
    if (this.stopped) return;
    const op = (this.switchOps[kind] += 1);
    this.update({ devices: { ...this.state.devices, [kind]: deviceId } });
    const media = this.media;
    if (!media) return;
    const switched = await media.switchActiveDevice(kind, deviceId).catch(() => null);
    if (this.media === media && op === this.switchOps[kind]) {
      if (switched === null) this.selectionFailures.add(kind);
      else if (switched === true) this.selectionFailures.delete(kind);
    }
    this.refresh();
  }

  /** Plays the others after the browser blocked autoplay; must run inside a click. */
  async resumeAudio() {
    await this.media?.startAudio().catch(() => undefined);
    this.refresh();
  }

  private async teardown() {
    this.stopRingTrace?.();
    this.stopRingTrace = undefined;
    this.session.off(MatrixRTCSessionEvent.MembershipsChanged, this.onMemberships);
    this.session.off(MatrixRTCSessionEvent.EncryptionKeyChanged, this.onKey);
    this.session.off(MatrixRTCSessionEvent.MembershipManagerError, this.onMembershipError);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    const rejoin = this.rejoin;
    this.rejoin = undefined;
    window.clearTimeout(rejoin?.timer);
    const media = this.detachMedia();
    this.wakeShownWaiters();
    this.endLeftoverWait?.();
    this.stoppedInputs.clear();
    this.update({
      microphoneTrack: undefined,
      screenShareStoppedInBackground: false,
      microphoneStopped: false,
      cameraStopped: false,
      participants: this.readParticipants(),
    });
    try {
      // A rejoin's withdrawal of the old membership that is still on its way gets the same wait.
      let timer = 0;
      const timeout = new Promise((resolve) => {
        timer = window.setTimeout(resolve, LEAVE_TIMEOUT_MS);
      });
      const membership = this.session.isJoined()
        ? this.session.leave(LEAVE_TIMEOUT_MS)
        : rejoin && Promise.race([rejoin.left, timeout]);
      // LiveKit's disconnect rejects when its leave message cannot go out; the call is over anyway.
      await Promise.allSettled([media?.disconnect(true), membership]);
      window.clearTimeout(timer);
      await media?.dispose().catch(() => undefined);
    } finally {
      // Kept past a failed disconnect: a lock left held would tell this device's other tabs for
      // the rest of the page's life that it is still in a call.
      this.worker?.terminate();
      this.worker = undefined;
      this.releaseDeviceLock?.();
      this.releaseDeviceLock = undefined;
    }
  }

  /** Lets go of the media room: none of its events reach this call any more. */
  private detachMedia(): MediaRoom | undefined {
    const media = this.media;
    this.media = undefined;
    this.watchInputTrack('microphone');
    this.watchInputTrack('camera');
    this.screenShareStart = undefined;
    if (media) this.watchMedia(media, 'off');
    media?.localParticipant.trackPublications.forEach((publication) => {
      publication.track?.off(TrackEvent.Restarted, this.refresh);
    });
    this.audioHost?.remove();
    this.audioHost = undefined;
    return media;
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
