// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { DisconnectReason } from 'livekit-client';
import { MatrixRTCSessionEvent } from 'matrix-js-sdk/lib/matrixrtc';
import { RoomCall, type RoomCallOptions } from './RoomCall';
import { getLivekitServiceUrl, requestSfuGrant } from './rtcFocus';
import {
  rememberCallForResume,
  RESUME_WINDOW_MS,
  takeCallResume,
  withdrawOwnMemberships,
} from './callResume';
import { sendCallKey } from './callKeyProvider';
import { defined } from '../../test/utils/defined';

/** What the fake LiveKit modules and the device lock record, shared with the module mocks. */
const fakes = vi.hoisted(() => ({
  rooms: [] as unknown[],
  workers: [] as Array<{ terminate: () => void }>,
  browserSupported: true,
  /** The next `connect` of a media room; resolves (connected) unless a test replaces it. */
  connect: undefined as undefined | ((room: unknown) => Promise<void>),
  /** Turning frame encryption on; resolves unless a test replaces it. */
  encryption: undefined as undefined | (() => Promise<void>),
  releases: [] as Array<() => void>,
  serviceUrl: 'https://rtc.calls.test',
  /** Every key set on a media key provider: index and media identity. */
  keys: [] as Array<{ keyIndex: number; identity: string; key: Uint8Array }>,
  nativeScreenShareAvailable: false,
  nativeScreenListener: undefined as
    | ((event: {
        generation: number;
        state: 'broadcasting' | 'stopped';
        reason?: string;
        detail?: string;
      }) => void)
    | undefined,
  nativePlugin: {
    start: vi.fn(async () => ({ generation: 1 })),
    setKey: vi.fn(async () => undefined),
    updateAllowedParticipants: vi.fn(async () => undefined),
    heartbeat: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    addListener: vi.fn(
      async (
        _event: 'stateChange',
        cb: (event: {
          generation: number;
          state: 'broadcasting' | 'stopped';
          reason?: string;
          detail?: string;
        }) => void
      ) => {
        fakes.nativeScreenListener = cb;
        return { remove: vi.fn() };
      }
    ),
  },
}));

const inputTrack = (id: string, readyState: MediaStreamTrackState = 'live') =>
  Object.assign(new EventTarget(), { id, readyState, muted: false });

/** LiveKit keeps the publication and swaps the media track inside it on restart. */
const inputPublication = (source: string, mediaStreamTrack = inputTrack(`${source}-default`)) => ({
  source,
  isMuted: false,
  async mute() {
    this.isMuted = true;
  },
  track: Object.assign(new EventEmitter(), { mediaStreamTrack }),
});

vi.mock('livekit-client', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class FakeMediaRoom extends Emitter {
    state = 'disconnected';

    canPlaybackAudio = true;

    remoteParticipants = new Map();

    private publications = new Map<string, ReturnType<typeof inputPublication>>();

    localParticipant = {
      isScreenShareEnabled: false,
      isSpeaking: false,
      isMicrophoneEnabled: false,
      getTrackPublication: vi.fn((source: string) => this.publications.get(source)),
      trackPublications: this.publications,
      setMicrophoneEnabled: vi.fn(async (on: boolean) => this.toggleInput('microphone', on)),
      setCameraEnabled: vi.fn(async (on: boolean) => this.toggleInput('camera', on)),
      setScreenShareEnabled: vi.fn(async (on: boolean) => {
        this.localParticipant.isScreenShareEnabled = on;
        if (on) {
          this.publications.set('screen_share', inputPublication('screen_share'));
        } else {
          this.publications.delete('screen_share');
        }
      }),
      setTrackSubscriptionPermissions: vi.fn(),
    };

    private toggleInput(source: string, on: boolean) {
      const publication =
        this.publications.get(source) ?? (on ? inputPublication(source) : undefined);
      if (publication) {
        publication.isMuted = !on;
        this.publications.set(source, publication);
      }
      return publication;
    }

    constructor(readonly options: unknown) {
      super();
      fakes.rooms.push(this);
    }

    setE2EEEnabled = vi.fn(async () => {
      await (fakes.encryption?.() ?? Promise.resolve());
    });

    connect = vi.fn(async () => {
      await (fakes.connect?.(this) ?? Promise.resolve());
      this.state = 'connected';
    });

    disconnect = vi.fn(async () => {
      this.state = 'disconnected';
    });

    dispose = vi.fn(async () => undefined);

    switchActiveDevice = vi.fn(async () => true);

    startAudio = vi.fn(async () => undefined);
  }
  return {
    ConnectionState: { Connected: 'connected', Disconnected: 'disconnected' },
    DisconnectReason: {
      UNKNOWN_REASON: 0,
      CLIENT_INITIATED: 1,
      DUPLICATE_IDENTITY: 2,
      SERVER_SHUTDOWN: 3,
      PARTICIPANT_REMOVED: 4,
      ROOM_DELETED: 5,
      STATE_MISMATCH: 6,
      JOIN_FAILURE: 7,
      MIGRATION: 8,
      SIGNAL_CLOSE: 9,
      ROOM_CLOSED: 10,
      USER_UNAVAILABLE: 11,
      USER_REJECTED: 12,
      SIP_TRUNK_FAILURE: 13,
      CONNECTION_TIMEOUT: 14,
      MEDIA_FAILURE: 15,
      AGENT_ERROR: 16,
    },
    // Event names are only keys here; the fake room emits them by the same name.
    RoomEvent: new Proxy({}, { get: (_target, key) => key }),
    Track: {
      Kind: { Audio: 'audio', Video: 'video' },
      Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' },
    },
    TrackEvent: { Restarted: 'restarted' },
    Room: FakeMediaRoom,
    isBrowserSupported: () => fakes.browserSupported,
    isE2EESupported: () => true,
  };
});

vi.mock('livekit-client/e2ee-worker?worker', async () => {
  return {
    default: class {
      terminate = vi.fn();

      constructor() {
        fakes.workers.push(this);
      }
    },
  };
});

vi.mock('./callKeyProvider', () => ({
  MatrixRtcKeyProvider: class {
    keys: Array<{ keyIndex: number; identity: string; key: Uint8Array }> = [];

    setParticipantKey = async (key: Uint8Array, keyIndex: number, identity: string) => {
      const entry = { key, keyIndex, identity };
      this.keys.push(entry);
      fakes.keys.push(entry);
    };
  },
  sendCallKey: vi.fn(async () => undefined),
}));

vi.mock('./rtcFocus', async (importOriginal) => {
  return {
    ...(await importOriginal<typeof import('./rtcFocus')>()),
    getLivekitServiceUrl: vi.fn(async () => fakes.serviceUrl),
    requestSfuGrant: vi.fn(async () => ({ url: 'wss://sfu.calls.test', jwt: 'jwt' })),
  };
});

vi.mock('./callResume', async (importOriginal) => {
  return {
    ...(await importOriginal<typeof import('./callResume')>()),
    withdrawOwnMemberships: vi.fn(async () => undefined),
  };
});

vi.mock('./nativeScreenShare', () => ({
  isNativeScreenShareAvailable: () => fakes.nativeScreenShareAvailable,
  nativeScreenShare: {
    start: (...args: unknown[]) => fakes.nativePlugin.start(...(args as [])),
    setKey: (...args: unknown[]) => fakes.nativePlugin.setKey(...(args as [])),
    updateAllowedParticipants: (...args: unknown[]) =>
      fakes.nativePlugin.updateAllowedParticipants(...(args as [])),
    heartbeat: (...args: unknown[]) => fakes.nativePlugin.heartbeat(...(args as [])),
    stop: (...args: unknown[]) => fakes.nativePlugin.stop(...(args as [])),
    addListener: (...args: unknown[]) =>
      fakes.nativePlugin.addListener(...(args as ['stateChange', never])),
  },
}));

const ME = '@me:calls.test';
const DEVICE = 'MYDEVICE';
const ROOM_ID = '!call:calls.test';

type FakeMembership = {
  userId: string;
  deviceId: string;
  transports: unknown[];
  isExpired: () => boolean;
  createdTs: () => number;
  applicationData?: Record<string, unknown>;
};

const membership = (
  userId: string,
  deviceId: string,
  createdTs = 1,
  applicationData?: Record<string, unknown>
): FakeMembership => ({
  userId,
  deviceId,
  transports: [{ type: 'livekit', livekit_service_url: fakes.serviceUrl }],
  isExpired: () => false,
  createdTs: () => createdTs,
  ...(applicationData ? { applicationData } : {}),
});

/** A MatrixRTC session of one room: its memberships, and whether this device joined it. */
class FakeSession extends EventEmitter {
  memberships: FakeMembership[] = [];

  joined = false;

  isJoined = () => this.joined;

  join = vi.fn((_identity: unknown, ..._rest: unknown[]) => {
    this.joined = true;
  });

  leave = vi.fn(async () => {
    this.joined = false;
    return true;
  });

  setMemberships(next: FakeMembership[]) {
    this.memberships = next;
    this.emit(MatrixRTCSessionEvent.MembershipsChanged, [], next);
  }
}

type FakeKeyProvider = {
  keys: Array<{ keyIndex: number; identity: string; key: Uint8Array }>;
};

type FakeMediaRoom = EventEmitter & {
  state: string;
  options: { encryption?: { keyProvider?: FakeKeyProvider; worker?: unknown } };
  connect: Mock;
  disconnect: Mock;
  dispose: Mock;
  setE2EEEnabled: Mock;
  remoteParticipants: Map<string, unknown>;
  localParticipant: {
    getTrackPublication: Mock;
    trackPublications: Map<string, unknown>;
    setMicrophoneEnabled: Mock;
    setCameraEnabled: Mock;
    setScreenShareEnabled: Mock;
    setTrackSubscriptionPermissions: Mock;
  };
  switchActiveDevice: Mock;
};

const mediaRooms = () => fakes.rooms as FakeMediaRoom[];

/** A promise and the functions that settle it, for steps a test holds open. */
const pending = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** Lets every queued promise step run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const setup = ({
  encrypted = false,
  grant,
  video,
  microphone,
  notify,
  stateEvents,
}: {
  encrypted?: boolean;
  grant?: RoomCallOptions['grant'];
  video?: boolean;
  microphone?: boolean;
  notify?: RoomCallOptions['notify'];
  stateEvents?: Record<string, Record<string, unknown>>;
} = {}) => {
  const session = new FakeSession();
  const mx = {
    matrixRTC: { getRoomSession: () => session },
    getSafeUserId: () => ME,
    getUserId: () => ME,
    getDeviceId: () => DEVICE,
    getSyncState: () => 'SYNCING',
    sendStateEvent: vi.fn(async () => ({ event_id: '$state' })),
    getOpenIdToken: vi.fn(async () => ({
      access_token: 'openid',
      token_type: 'Bearer',
      matrix_server_name: 'calls.test',
      expires_in: 3600,
    })),
  } as unknown as MatrixClient;
  const room = {
    roomId: ROOM_ID,
    getVersion: () => '11',
    hasEncryptionStateEvent: () => encrypted,
    getJoinedMemberCount: () => 2,
    ...(stateEvents
      ? {
          currentState: {
            getStateEvents: (type: string, key?: string) => {
              if (type !== 'org.matrix.msc3401.call.member' || key === undefined) return null;
              const content = stateEvents[key];
              return content ? { getContent: () => content } : null;
            },
          },
        }
      : {}),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Room;
  // The device lock `startCall` took before making the call.
  const releaseDeviceLock = vi.fn();
  fakes.releases.push(releaseDeviceLock);
  const call = new RoomCall({ mx, room, releaseDeviceLock, grant, video, microphone, notify });
  return { call, session, mx, room };
};

beforeEach(() => {
  fakes.rooms.length = 0;
  fakes.workers.length = 0;
  fakes.releases.length = 0;
  fakes.browserSupported = true;
  fakes.connect = undefined;
  fakes.encryption = undefined;
  fakes.keys.length = 0;
  fakes.nativeScreenShareAvailable = false;
  fakes.nativeScreenListener = undefined;
  Object.values(fakes.nativePlugin).forEach((fn) => fn.mockClear());
  vi.mocked(getLivekitServiceUrl).mockClear();
  vi.mocked(requestSfuGrant).mockReset();
  vi.mocked(requestSfuGrant).mockResolvedValue({ url: 'wss://sfu.calls.test', jwt: 'jwt' });
  vi.mocked(withdrawOwnMemberships).mockClear();
  vi.mocked(sendCallKey).mockReset();
  vi.mocked(sendCallKey).mockResolvedValue(undefined);
});

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
};

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  document.body.innerHTML = '';
});

describe('RoomCall leave', () => {
  it('releases the encryption worker and the device lock when LiveKit fails to disconnect', async () => {
    const { call } = setup({ encrypted: true });
    await call.join();
    const media = defined(mediaRooms()[0], 'the LiveKit room');
    media.disconnect.mockRejectedValueOnce(new Error('leave message not sent'));

    await expect(call.leave()).resolves.toBeUndefined();

    expect(defined(fakes.workers[0], 'the encryption worker').terminate).toHaveBeenCalledTimes(1);
    expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
    expect(call.getState().phase).toBe('ended');
  });
});

describe('RoomCall join, left early', () => {
  it('stops in the wait for its leftover membership and asks for no grant', async () => {
    const { call, session } = setup();
    session.memberships = [membership(ME, DEVICE)];

    const joining = call.join();
    await settle();
    expect(withdrawOwnMemberships).toHaveBeenCalledTimes(1);
    const leaving = call.leave();
    session.setMemberships([]);
    await joining;
    await leaving;

    expect(requestSfuGrant).not.toHaveBeenCalled();
    expect(mediaRooms()).toHaveLength(0);
    expect(session.join).not.toHaveBeenCalled();
    expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
    expect(call.getState().phase).toBe('ended');
  });

  it('stops while the grant is on the way and opens no media connection', async () => {
    const { call, session } = setup();
    const grant = pending<{ url: string; jwt: string }>();
    vi.mocked(requestSfuGrant).mockReturnValueOnce(grant.promise);

    const joining = call.join();
    await settle();
    expect(requestSfuGrant).toHaveBeenCalledTimes(1);
    await call.leave();
    grant.resolve({ url: 'wss://sfu.calls.test', jwt: 'jwt' });
    await joining;

    expect(mediaRooms()).toHaveLength(0);
    expect(session.join).not.toHaveBeenCalled();
    expect(call.getState().phase).toBe('ended');
  });
});

describe('RoomCall join, call service', () => {
  it('refuses a call that runs on a backend a room member named, before asking for a token', async () => {
    const { call, session, mx } = setup();
    session.memberships = [
      {
        ...membership('@other:calls.test', 'OTHER'),
        transports: [{ type: 'livekit', livekit_service_url: 'https://rtc.attacker.test' }],
      },
    ];

    await call.join();

    expect(mx.getOpenIdToken).not.toHaveBeenCalled();
    expect(requestSfuGrant).not.toHaveBeenCalled();
    expect(session.join).not.toHaveBeenCalled();
    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'untrustedService' });
  });

  it("joins a running call on this deployment's backend", async () => {
    const { call, session } = setup();
    session.memberships = [membership('@other:calls.test', 'OTHER')];

    await call.join();

    expect(requestSfuGrant).toHaveBeenCalledWith(
      fakes.serviceUrl,
      expect.objectContaining({ roomId: ROOM_ID })
    );
    expect(call.getState().phase).toBe('connected');
  });
});

/** The one LiveKit room a join made. */
const onlyMediaRoom = () => {
  expect(mediaRooms()).toHaveLength(1);
  return defined(mediaRooms()[0], 'the LiveKit room');
};

describe('RoomCall join', () => {
  it('announces the membership once the call is granted, connects the media meanwhile, then opens the microphone', async () => {
    const connected = pending();
    fakes.connect = () => connected.promise;
    const { call, session } = setup();

    const joining = call.join();
    await vi.waitFor(() => expect(session.join).toHaveBeenCalledTimes(1));
    // The others hear of the call while the media still connects.
    const media = onlyMediaRoom();
    expect(media.connect).toHaveBeenCalledWith('wss://sfu.calls.test', 'jwt');
    expect(call.getState().phase).toBe('connecting');
    expect(media.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    connected.resolve();
    await joining;

    expect(session.join).toHaveBeenCalledWith(
      { userId: ME, deviceId: DEVICE, memberId: `${ME}:${DEVICE}` },
      [{ type: 'livekit', livekit_service_url: fakes.serviceUrl, livekit_alias: ROOM_ID }],
      expect.objectContaining({ manageMediaKeys: false, callIntent: 'audio' })
    );
    expect(media.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(media.options.encryption).toBeUndefined();
    // The device lock stays held while the call runs.
    expect(fakes.releases[0]).not.toHaveBeenCalled();
    expect(call.getState().phase).toBe('connected');
    expect(call.getState().problem).toBeUndefined();
  });

  it('encrypts the media of an encrypted room and shares its keys over the session', async () => {
    const { call, session } = setup({ encrypted: true });

    await call.join();

    const media = onlyMediaRoom();
    expect(fakes.workers).toHaveLength(1);
    expect(media.options.encryption).toBeDefined();
    expect(media.setE2EEEnabled).toHaveBeenCalledWith(true);
    expect(session.join).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ manageMediaKeys: true })
    );
  });

  it('rings the other people for thirty seconds', async () => {
    const { call, session } = setup({ notify: 'ring' });

    await call.join();

    // The SDK would let an unanswered ring run for ninety seconds.
    expect(session.join).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ notificationType: 'ring', notificationLifetimeMs: 30_000 })
    );
  });

  it('fails for a browser without WebRTC, and lets the device lock go', async () => {
    fakes.browserSupported = false;
    const { call, session } = setup();

    await call.join();

    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'browser' });
    expect(session.join).not.toHaveBeenCalled();
    await settle();
    expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
  });

  it('fails when the deployment announces no backend, and lets the lock go', async () => {
    vi.mocked(getLivekitServiceUrl).mockResolvedValueOnce(undefined);
    const { call } = setup();

    await call.join();
    await settle();

    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'homeserver' });
    expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
  });

  it('fails when the backend refuses the grant, and opens no media connection', async () => {
    vi.mocked(requestSfuGrant).mockRejectedValueOnce(new Error('403'));
    const { call } = setup();

    await call.join();
    await settle();

    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'service' });
    expect(mediaRooms()).toHaveLength(0);
    expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
  });

  it('goes on without a microphone it cannot open and clears the warning after retrying it', async () => {
    fakes.connect = async (room) => {
      (room as FakeMediaRoom).localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(
        new Error('NotAllowedError')
      );
    };
    const { call, mx } = setup();

    await call.join();

    expect(call.getState()).toMatchObject({
      phase: 'connected',
      problem: 'device',
      microphone: false,
    });
    rememberCallForResume(mx, { kind: 'room', call }, 1_000);
    expect(takeCallResume(mx, 1_500)).toMatchObject({ microphone: false });

    const media = onlyMediaRoom();
    // Staying muted does not resolve a failure to open the microphone.
    await call.setMicrophone(false);
    expect(call.getState().problem).toBe('device');

    const opened = pending<ReturnType<typeof inputPublication>>();
    media.localParticipant.setMicrophoneEnabled.mockReturnValueOnce(opened.promise);
    const retry = call.setMicrophone(true);
    expect(call.getState()).toMatchObject({ microphone: true, problem: 'device' });

    const publication = inputPublication('microphone', MIC_A);
    media.localParticipant.trackPublications.set('microphone', publication);
    opened.resolve(publication);
    await retry;
    expect(call.getState().problem).toBeUndefined();
  });

  it('keeps the warning until both the microphone and camera have recovered', async () => {
    const { call } = setup();
    await call.join();
    const { localParticipant } = onlyMediaRoom();
    await call.setMicrophone(false);
    localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(new Error('NotReadableError'));
    localParticipant.setCameraEnabled.mockRejectedValueOnce(new Error('NotReadableError'));

    await call.setMicrophone(true);
    await call.setCamera(true);
    expect(call.getState()).toMatchObject({ microphone: false, camera: false, problem: 'device' });

    await call.setCamera(true);
    expect(call.getState()).toMatchObject({ camera: true, problem: 'device' });

    // LiveKit may finish waiting for a publication without getting one.
    localParticipant.setMicrophoneEnabled.mockResolvedValueOnce(undefined);
    await call.setMicrophone(true);
    expect(call.getState()).toMatchObject({ microphone: false, problem: 'device' });

    await call.setMicrophone(!call.getState().microphone);
    expect(call.getState().microphone).toBe(true);
    expect(call.getState().problem).toBeUndefined();
  });

  it('records a first microphone enable rejection even if a device pick settled first', async () => {
    const opening = pending();
    fakes.connect = async (room) => {
      (room as FakeMediaRoom).localParticipant.setMicrophoneEnabled.mockReturnValueOnce(
        opening.promise
      );
    };
    const { call } = setup();
    const joining = call.join();
    await settle();
    expect(onlyMediaRoom().localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    await call.setDevice('audioinput', 'mic-b');

    opening.reject(new Error('NotReadableError'));
    await joining;
    expect(call.getState()).toMatchObject({ microphone: false, problem: 'device' });
  });

  it.each(['ended', 'OS-muted'] as const)(
    'keeps the mute action after enabling an existing %s microphone publication',
    async (condition) => {
      const { call } = setup({ microphone: false });
      await call.join();
      const { localParticipant } = onlyMediaRoom();
      const track = inputTrack('mic', condition === 'ended' ? 'ended' : 'live');
      track.muted = condition === 'OS-muted';
      const publication = inputPublication('microphone', track);
      localParticipant.trackPublications.set('microphone', publication);
      const displayed: boolean[] = [];
      const unsubscribe = call.subscribe(() => displayed.push(call.getState().microphone));

      // LiveKit unmute does not replace the native track if the publication is already unmuted.
      await call.setMicrophone(true);
      unsubscribe();
      expect(displayed).not.toContain(false);
      expect(call.getState()).toMatchObject({ microphone: true, problem: 'device' });

      await call.setMicrophone(!call.getState().microphone);
      expect(publication.isMuted).toBe(true);
      expect(call.getState().microphone).toBe(false);
    }
  );

  it('clears a camera capture warning when the same LiveKit track restarts', async () => {
    const { call } = setup();
    await call.join();
    const media = onlyMediaRoom();
    const publication = inputPublication('camera', inputTrack('ended', 'ended'));
    media.localParticipant.trackPublications.set('camera', publication);
    media.emit('LocalTrackPublished', publication);
    await call.setCamera(true);
    expect(call.getState().problem).toBe('device');

    publication.track.mediaStreamTrack = inputTrack('restarted');
    publication.track.emit('restarted');
    expect(call.getState().problem).toBeUndefined();
  });

  it('clears a capture failure on reconnect only if the microphone recovered', async () => {
    const { call } = setup({ microphone: false });
    await call.join();
    const media = onlyMediaRoom();
    media.localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(
      new Error('NotReadableError')
    );
    await call.setMicrophone(true);

    media.emit('Reconnecting');
    media.emit('Reconnected');
    expect(call.getState()).toMatchObject({ phase: 'connected', problem: 'device' });
    media.emit('Reconnecting');
    media.localParticipant.trackPublications.set(
      'microphone',
      inputPublication('microphone', MIC_A)
    );
    media.emit('Reconnected');
    expect(call.getState()).toMatchObject({
      phase: 'connected',
      microphone: true,
      microphoneTrack: MIC_A,
      problem: undefined,
    });
    await call.setMicrophone(!call.getState().microphone);
    expect(media.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    expect(call.getState()).toMatchObject({ microphone: false, microphoneTrack: undefined });
  });

  it.each(['live', 'OS-muted'] as const)(
    'mutes a late %s microphone publication after the user chose Off',
    async (condition) => {
      const { call } = setup({ microphone: false });
      await call.join();
      const media = onlyMediaRoom();
      media.localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(
        new Error('NotReadableError')
      );
      await call.setMicrophone(true);
      await call.setMicrophone(false);

      const track = inputTrack('mic');
      track.muted = condition === 'OS-muted';
      const publication = inputPublication('microphone', track);
      media.emit('Reconnecting');
      media.localParticipant.trackPublications.set('microphone', publication);
      media.emit('Reconnected');
      await settle();
      expect(publication.isMuted).toBe(true);
      expect(call.getState()).toMatchObject({
        microphone: false,
        microphoneTrack: undefined,
        problem: condition === 'OS-muted' ? 'device' : undefined,
      });

      track.muted = false;
      track.dispatchEvent(new Event('unmute'));
      expect(publication.isMuted).toBe(true);
      await call.setMicrophone(!call.getState().microphone);
      expect(media.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
      expect(publication.isMuted).toBe(false);
      expect(call.getState()).toMatchObject({ microphone: true, problem: undefined });
    }
  );

  it('keeps the capture warning until a live native track emits unmute', async () => {
    const { call } = setup({ microphone: false });
    await call.join();
    const media = onlyMediaRoom();
    media.localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(
      new Error('NotReadableError')
    );
    await call.setMicrophone(true);

    const track = inputTrack('os-muted');
    track.muted = true;
    const publication = inputPublication('microphone', track);
    media.localParticipant.trackPublications.set('microphone', publication);
    media.emit('LocalTrackPublished', publication);
    expect(call.getState()).toMatchObject({ microphone: true, problem: 'device' });

    track.muted = false;
    track.dispatchEvent(new Event('unmute'));
    expect(call.getState()).toMatchObject({ microphone: true, problem: undefined });
  });

  it('does not open the camera twice when the user turns it on during microphone setup', async () => {
    const opening = pending<ReturnType<typeof inputPublication>>();
    fakes.connect = async (room) => {
      (room as FakeMediaRoom).localParticipant.setMicrophoneEnabled.mockReturnValueOnce(
        opening.promise
      );
    };
    const { call } = setup();
    const joining = call.join();
    await settle();
    const { localParticipant } = onlyMediaRoom();
    expect(localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    await call.setCamera(true);
    const publication = inputPublication('microphone', MIC_A);
    localParticipant.trackPublications.set('microphone', publication);
    opening.resolve(publication);
    await joining;
    expect(localParticipant.setCameraEnabled).toHaveBeenCalledTimes(1);
  });

  it('keeps a camera warning from join through mute and reconnect until the camera opens', async () => {
    fakes.connect = async (room) => {
      (room as FakeMediaRoom).localParticipant.setCameraEnabled.mockRejectedValueOnce(
        new Error('NotReadableError')
      );
    };
    const { call } = setup({ video: true });
    await call.join();
    expect(call.getState()).toMatchObject({ camera: false, problem: 'device' });

    await call.setCamera(false);
    expect(call.getState().problem).toBe('device');
    const media = onlyMediaRoom();
    media.emit('Reconnecting');
    expect(call.getState()).toMatchObject({ phase: 'reconnecting', problem: 'device' });
    media.emit('Reconnected');
    expect(call.getState()).toMatchObject({ phase: 'connected', problem: 'device' });

    await call.setCamera(true);
    expect(call.getState().camera).toBe(true);
    expect(call.getState().problem).toBeUndefined();
  });

  it('keeps a failed microphone pick visible while the previous microphone is live', async () => {
    const { call } = setup();
    await call.join();
    const media = onlyMediaRoom();
    const { switchActiveDevice } = media;
    expect(call.getState().microphoneTrack?.readyState).toBe('live');
    switchActiveDevice.mockResolvedValueOnce(false);
    await call.setDevice('audioinput', 'mic-b');
    expect(call.getState().problem).toBeUndefined();

    switchActiveDevice.mockRejectedValueOnce(new Error('NotReadableError'));
    await call.setDevice('audioinput', 'mic-b');
    media.emit('TrackUnmuted');
    expect(call.getState().problem).toBe('device');

    await call.setDevice('videoinput', 'camera-b');
    switchActiveDevice.mockResolvedValueOnce(false);
    await call.setDevice('audioinput', 'mic-b');
    expect(call.getState().problem).toBe('device');

    await call.setDevice('audioinput', 'mic-b');
    expect(call.getState().problem).toBeUndefined();
  });

  it('refreshes capture recovery after a device switch returns false', async () => {
    const { call } = setup({ microphone: false });
    await call.join();
    const { localParticipant, switchActiveDevice } = onlyMediaRoom();
    localParticipant.setMicrophoneEnabled.mockResolvedValueOnce(undefined);
    await call.setMicrophone(true);
    expect(call.getState().problem).toBe('device');

    switchActiveDevice.mockImplementationOnce(async () => {
      localParticipant.trackPublications.set('microphone', inputPublication('microphone'));
      return false;
    });
    await call.setDevice('audioinput', 'mic-b');
    expect(call.getState().problem).toBeUndefined();
  });

  it('keeps a camera capture warning when reselecting the camera while muted', async () => {
    const { call } = setup({ video: true });
    await call.join();
    const { localParticipant, switchActiveDevice } = onlyMediaRoom();
    await call.setCamera(false);
    localParticipant.setCameraEnabled.mockRejectedValueOnce(new Error('NotReadableError'));
    await call.setCamera(true);
    expect(call.getState()).toMatchObject({ camera: false, problem: 'device' });

    // A successful selection clears a selection failure, but not a capture failure.
    switchActiveDevice.mockRejectedValueOnce(new Error('Switch failed'));
    await call.setDevice('videoinput', 'camera-b');
    await call.setDevice('videoinput', 'camera-b');
    expect(call.getState()).toMatchObject({ camera: false, problem: 'device' });

    await call.setCamera(true);
    expect(call.getState().problem).toBeUndefined();
  });

  it('clears a failed speaker switch only after a successful speaker switch', async () => {
    const { call } = setup();
    await call.join();
    onlyMediaRoom().switchActiveDevice.mockRejectedValueOnce(new Error('Cannot set audio output'));
    await call.setDevice('audiooutput', 'speaker-b');
    expect(call.getState().problem).toBe('device');
    await call.setMicrophone(true);
    expect(call.getState().problem).toBe('device');
    await call.setDevice('audiooutput', 'speaker-a');
    expect(call.getState().problem).toBeUndefined();
  });

  it.each([
    ['audioinput', true],
    ['audioinput', false],
    ['audiooutput', true],
    ['audiooutput', false],
  ] as const)('uses the newer %s pick result (success: %s)', async (kind, newerSucceeds) => {
    const { call } = setup();
    await call.join();
    const { switchActiveDevice } = onlyMediaRoom();
    const older = pending<boolean>();
    switchActiveDevice.mockReturnValueOnce(older.promise);
    const first = call.setDevice(kind, 'device-a');
    if (!newerSucceeds) switchActiveDevice.mockRejectedValueOnce(new Error('Switch failed'));
    await call.setDevice(kind, 'device-b');

    if (newerSucceeds) older.reject(new Error('Stale switch failed'));
    else older.resolve(true);
    await first;
    expect(call.getState().problem).toBe(newerSucceeds ? undefined : 'device');
  });

  it('ignores a superseded mute failure but keeps the latest pick failure', async () => {
    const { call } = setup();
    await call.join();
    const { localParticipant, switchActiveDevice } = onlyMediaRoom();
    const muting = pending();
    const switching = pending<boolean>();
    localParticipant.setMicrophoneEnabled.mockReturnValueOnce(muting.promise);
    switchActiveDevice.mockReturnValueOnce(switching.promise);
    const mute = call.setMicrophone(false);
    const select = call.setDevice('audioinput', 'mic-b');
    await call.setMicrophone(true);

    muting.reject(new Error('Stale mute failed'));
    switching.reject(new Error('Switch failed'));
    await Promise.all([mute, select]);
    expect(call.getState()).toMatchObject({ microphone: true, problem: 'device' });
  });

  it('does not retry overlapping rejected mutes', async () => {
    const { call } = setup();
    await call.join();
    const { setMicrophoneEnabled } = onlyMediaRoom().localParticipant;
    const first = pending();
    const second = pending();
    const failure = new Error('Mute failed');
    setMicrophoneEnabled
      .mockClear()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      // Cap the rejections so a broken retry loop cannot hang the test run.
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(failure);
    const firstMute = call.setMicrophone(false);
    const secondMute = call.setMicrophone(false);
    first.reject(failure);
    second.reject(failure);
    await Promise.all([firstMute, secondMute]);

    expect(setMicrophoneEnabled).toHaveBeenCalledTimes(2);
  });

  it.each(['microphone', 'camera'] as const)(
    'shows the %s as on after a rejected mute but remembers the requested Off for reload',
    async (kind) => {
      const { call, mx } = setup({ video: true });
      await call.join();
      const { setMicrophoneEnabled, setCameraEnabled } = onlyMediaRoom().localParticipant;
      const mute = kind === 'microphone' ? setMicrophoneEnabled : setCameraEnabled;
      mute.mockRejectedValueOnce(new Error('Mute failed'));

      if (kind === 'microphone') await call.setMicrophone(false);
      else await call.setCamera(false);
      expect(call.getState()).toMatchObject({ microphone: true, camera: true, problem: undefined });

      rememberCallForResume(mx, { kind: 'room', call }, 1_000);
      expect(takeCallResume(mx, 1_500)).toMatchObject(
        kind === 'microphone'
          ? { microphone: false, camera: true }
          : { microphone: true, camera: false }
      );
    }
  );

  it.each([true, false])(
    'honors microphone Off when a superseded enable fails: %s',
    async (fails) => {
      const { call } = setup({ microphone: false });
      await call.join();
      const { localParticipant } = onlyMediaRoom();
      const opening = pending<ReturnType<typeof inputPublication>>();
      localParticipant.setMicrophoneEnabled.mockReturnValueOnce(opening.promise);
      const enable = call.setMicrophone(true);
      await call.setMicrophone(false);

      const publication = inputPublication('microphone', MIC_A);
      if (fails) {
        opening.reject(new Error('NotReadableError'));
      } else {
        localParticipant.trackPublications.set('microphone', publication);
        opening.resolve(publication);
      }
      await enable;
      if (!fails) expect(publication.isMuted).toBe(true);
      expect(call.getState().microphone).toBe(false);
      expect(call.getState().problem).toBe(fails ? 'device' : undefined);
    }
  );

  it('does not retry a rejected late mute when the OS unmutes the microphone', async () => {
    const { call } = setup({ microphone: false });
    await call.join();
    const { localParticipant } = onlyMediaRoom();
    const opening = pending();
    localParticipant.setMicrophoneEnabled.mockReturnValueOnce(opening.promise);
    const enable = call.setMicrophone(true);
    await call.setMicrophone(false);

    const track = inputTrack('os-muted');
    track.muted = true;
    const publication = inputPublication('microphone', track);
    const mute = vi.spyOn(publication, 'mute').mockRejectedValueOnce(new Error('Mute failed'));
    localParticipant.trackPublications.set('microphone', publication);
    opening.resolve();
    await enable;
    expect(call.getState().microphone).toBe(true);

    track.muted = false;
    track.dispatchEvent(new Event('unmute'));
    await settle();
    expect(mute).toHaveBeenCalledTimes(1);
    expect(call.getState().microphone).toBe(true);
  });

  it('records a superseded enable with no publication while the latest choice is On', async () => {
    const { call } = setup({ microphone: false });
    await call.join();
    const { localParticipant } = onlyMediaRoom();
    const first = pending<undefined>();
    const second = pending<ReturnType<typeof inputPublication>>();
    localParticipant.setMicrophoneEnabled
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const firstEnable = call.setMicrophone(true);
    const secondEnable = call.setMicrophone(true);
    first.resolve(undefined);
    await firstEnable;
    expect(call.getState().problem).toBe('device');

    const publication = inputPublication('microphone');
    localParticipant.trackPublications.set('microphone', publication);
    second.resolve(publication);
    await secondEnable;
    expect(call.getState()).toMatchObject({ microphone: true, problem: undefined });
  });

  it('does not update the call when a pending retry rejects after disconnect', async () => {
    const { call } = setup({ microphone: false });
    await call.join();
    const media = onlyMediaRoom();
    media.localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(
      new Error('NotReadableError')
    );
    await call.setMicrophone(true);

    expect(call.getState().problem).toBe('device');
    const opened = pending<{ source: string }>();
    media.localParticipant.setMicrophoneEnabled.mockReturnValueOnce(opened.promise);
    const retry = call.setMicrophone(true);
    media.emit('Disconnected');
    const disconnected = call.getState();
    opened.reject(new Error('NotReadableError'));
    await retry;

    expect(disconnected).toMatchObject({ phase: 'failed', problem: 'connection' });
    expect(call.getState()).toBe(disconnected);
  });

  it('fails with the connection problem, and withdraws the membership, when the media drops while connecting', async () => {
    fakes.connect = async (room) => {
      (room as FakeMediaRoom).emit('Disconnected');
      throw new Error('Client initiated disconnect');
    };
    const { call, session } = setup();

    await call.join();
    await settle();

    // The connect that fails with it does not turn the problem into a refused service.
    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'connection' });
    expect(session.leave).toHaveBeenCalledTimes(1);
    expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
  });

  it('withdraws the membership when the media dropped although its connect went through', async () => {
    fakes.connect = async (room) => {
      (room as FakeMediaRoom).emit('Disconnected');
    };
    const { call, session } = setup();

    await call.join();

    expect(session.leave).toHaveBeenCalledTimes(1);
    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'connection' });
    expect(onlyMediaRoom().disconnect).toHaveBeenCalled();
  });

  it('fails with the service problem, and opens no media connection, when the membership cannot be made', async () => {
    const { call, session } = setup({ encrypted: true });
    session.join.mockImplementationOnce(() => {
      throw new Error('no such slot');
    });

    await expect(call.join()).resolves.toBeUndefined();
    await settle();

    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'service' });
    expect(mediaRooms()).toHaveLength(0);
    expect(fakes.workers).toHaveLength(0);
    expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
  });
});

describe('RoomCall join, left while connecting', () => {
  it('withdraws its membership when left during the connect', async () => {
    const connected = pending();
    fakes.connect = () => connected.promise;
    const { call, session } = setup();

    const joining = call.join();
    await settle();
    const leaving = call.leave();
    connected.reject(new Error('Client initiated disconnect'));
    await joining;
    await leaving;

    expect(onlyMediaRoom().disconnect).toHaveBeenCalled();
    expect(session.leave).toHaveBeenCalledTimes(1);
    expect(call.getState().phase).toBe('ended');
    expect(call.getState().problem).toBeUndefined();
  });

  it('does not connect after a leave while frame encryption was being set up', async () => {
    const encryptionOn = pending();
    fakes.encryption = () => encryptionOn.promise;
    const { call } = setup({ encrypted: true });

    const joining = call.join();
    await settle();
    await call.leave();
    encryptionOn.resolve();
    await joining;

    expect(onlyMediaRoom().connect).not.toHaveBeenCalled();
    expect(defined(fakes.workers[0], 'the encryption worker').terminate).toHaveBeenCalled();
    expect(call.getState().phase).toBe('ended');
  });
});

describe('RoomCall after joining', () => {
  it('fails with the connection problem when the media server drops this device', async () => {
    const { call, session } = setup();
    await call.join();

    onlyMediaRoom().emit('Disconnected');
    await settle();

    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'connection' });
    expect(session.leave).toHaveBeenCalledTimes(1);
    expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
  });

  it('fails with the connection problem when its membership cannot be kept', async () => {
    const { call, session } = setup();
    await call.join();

    session.emit(MatrixRTCSessionEvent.MembershipManagerError, new Error('state event refused'));
    await settle();

    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'connection' });
    expect(session.leave).toHaveBeenCalledTimes(1);
  });

  it('clears remote speaking and connected state when failing before teardown', async () => {
    const { call, session } = setup();
    await call.join();
    const media = onlyMediaRoom();
    const peerIdentity = '@peer:calls.test:PEERDEVICE';
    const remoteParticipant = {
      identity: peerIdentity,
      isSpeaking: true,
      isMicrophoneEnabled: true,
      audioTrackPublications: new Map(),
      getTrackPublication: () => undefined,
    };
    media.remoteParticipants.set(peerIdentity, remoteParticipant);
    session.setMemberships([membership(ME, DEVICE), membership('@peer:calls.test', 'PEERDEVICE')]);
    media.emit('ActiveSpeakersChanged', [remoteParticipant]);

    expect(call.getState().participants).toEqual([
      expect.objectContaining({ key: `${ME}:${DEVICE}`, connected: true, speaking: false }),
      expect.objectContaining({
        key: peerIdentity,
        connected: true,
        speaking: true,
        microphone: true,
      }),
    ]);

    media.disconnect.mockImplementationOnce(async () => {
      remoteParticipant.isSpeaking = false;
      media.remoteParticipants.clear();
      media.emit('ParticipantDisconnected', remoteParticipant);
      media.emit('ActiveSpeakersChanged', []);
      media.state = 'disconnected';
    });

    session.emit(MatrixRTCSessionEvent.MembershipManagerError, new Error('state event refused'));
    await settle();

    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'connection' });
    expect(call.getState().participants).toEqual([
      expect.objectContaining({ key: `${ME}:${DEVICE}`, connected: false, speaking: false }),
      expect.objectContaining({
        key: peerIdentity,
        connected: false,
        speaking: false,
        microphone: false,
      }),
    ]);
  });

  it('keeps a failed call failed when it is left, and lets go of everything once', async () => {
    const { call, session } = setup({ encrypted: true });
    await call.join();
    const media = onlyMediaRoom();

    media.emit('Disconnected');
    await call.leave();

    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'connection' });
    expect(media.disconnect).toHaveBeenCalledTimes(1);
    expect(session.leave).toHaveBeenCalledTimes(1);
    expect(defined(fakes.workers[0], 'the encryption worker').terminate).toHaveBeenCalledTimes(1);
    expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
  });

  it('ignores its own disconnect after a leave', async () => {
    const { call } = setup();
    await call.join();
    const media = onlyMediaRoom();
    // LiveKit sends its leave message first and only then reports the room disconnected.
    media.disconnect.mockImplementationOnce(async () => {
      await Promise.resolve();
      media.emit('Disconnected');
    });

    await call.leave();

    expect(call.getState().phase).toBe('ended');
    expect(call.getState().problem).toBeUndefined();
  });
});

const MIC_A = inputTrack('mic-a');
const MIC_B = inputTrack('mic-b');
const MIC_C = inputTrack('mic-c');

describe('RoomCall microphone track', () => {
  it('shows the microphone it publishes, none while muted, and tells its subscribers of each change', async () => {
    fakes.connect = async (room) => {
      (room as FakeMediaRoom).localParticipant.setMicrophoneEnabled.mockResolvedValueOnce(
        undefined
      );
    };
    const { call } = setup();
    await call.join();
    const media = onlyMediaRoom();
    const listener = vi.fn();
    call.subscribe(listener);
    expect(call.getState().microphoneTrack).toBeUndefined();

    const publication = inputPublication('microphone', MIC_A);
    media.localParticipant.trackPublications.set('microphone', publication);
    media.emit('LocalTrackPublished', publication);
    expect(call.getState().microphoneTrack).toBe(MIC_A);
    expect(listener).toHaveBeenCalled();

    publication.isMuted = true;
    media.emit('TrackMuted', publication);
    expect(call.getState().microphoneTrack).toBeUndefined();
    publication.isMuted = false;
    media.emit('TrackUnmuted', publication);
    expect(call.getState().microphoneTrack).toBe(MIC_A);

    // Another microphone: LiveKit keeps its track and swaps the media track inside it.
    publication.track.mediaStreamTrack = MIC_B;
    media.emit('ActiveDeviceChanged', 'audioinput', 'usb-mic');
    expect(call.getState()).toMatchObject({
      microphoneTrack: MIC_B,
      devices: { audioinput: 'usb-mic' },
    });

    // The same microphone opened again (its track had ended) is a new media track too.
    publication.track.mediaStreamTrack = MIC_C;
    listener.mockClear();
    publication.track.emit('restarted');
    expect(call.getState().microphoneTrack).toBe(MIC_C);
    expect(listener).toHaveBeenCalled();

    media.localParticipant.trackPublications.delete('microphone');
    media.emit('LocalTrackUnpublished', publication);
    expect(call.getState().microphoneTrack).toBeUndefined();
    expect(publication.track.listenerCount('restarted')).toBe(0);
  });

  it('shows the new microphone once a switch this device asked for is done', async () => {
    const { call } = setup();
    await call.join();
    const media = onlyMediaRoom();
    const publication = inputPublication('microphone', MIC_A);
    media.localParticipant.trackPublications.set('microphone', publication);
    media.emit('LocalTrackPublished', publication);
    media.switchActiveDevice.mockImplementationOnce(async () => {
      publication.track.mediaStreamTrack = MIC_B;
      return true;
    });

    await call.setDevice('audioinput', 'usb-mic');

    expect(call.getState().microphoneTrack).toBe(MIC_B);
  });

  it.each(['restart', 'unpublish', 'leave'] as const)(
    'removes native mute and unmute listeners on %s',
    async (change) => {
      const { call } = setup();
      await call.join();
      const media = onlyMediaRoom();
      const track = inputTrack('original');
      const addListener = vi.spyOn(track, 'addEventListener');
      const removeListener = vi.spyOn(track, 'removeEventListener');
      const publication = inputPublication('microphone', track);
      media.localParticipant.trackPublications.set('microphone', publication);
      media.emit('LocalTrackPublished', publication);

      if (change === 'restart') {
        publication.track.mediaStreamTrack = inputTrack('restarted');
        publication.track.emit('restarted');
      } else if (change === 'unpublish') {
        media.localParticipant.trackPublications.delete('microphone');
        media.emit('LocalTrackUnpublished', publication);
      } else {
        await call.leave();
      }
      expect(addListener).toHaveBeenCalledWith('mute', expect.any(Function));
      expect(addListener).toHaveBeenCalledWith('unmute', expect.any(Function));
      expect(removeListener.mock.calls).toEqual(addListener.mock.calls);
    }
  );

  it('lets go of the microphone track when the call ends', async () => {
    const { call } = setup();
    await call.join();
    const media = onlyMediaRoom();
    const publication = inputPublication('microphone', MIC_A);
    media.localParticipant.trackPublications.set('microphone', publication);
    media.emit('LocalTrackPublished', publication);
    expect(publication.track.listenerCount('restarted')).toBe(1);

    await call.leave();

    expect(call.getState().microphoneTrack).toBeUndefined();
    expect(publication.track.listenerCount('restarted')).toBe(0);
  });
});

describe('RoomCall join, grant asked for ahead', () => {
  it('joins with the grant asked for while the call was prepared, without asking again', async () => {
    const early = pending<
      { serviceUrl: string; grant: { url: string; jwt: string } } | undefined
    >();
    const { call, session, mx } = setup({ grant: early.promise });

    const joining = call.join();
    await settle();
    // The join waits for that grant rather than asking for one of its own.
    expect(session.join).not.toHaveBeenCalled();
    early.resolve({
      serviceUrl: fakes.serviceUrl,
      grant: { url: 'wss://early.test', jwt: 'early' },
    });
    await joining;

    expect(mx.getOpenIdToken).not.toHaveBeenCalled();
    expect(requestSfuGrant).not.toHaveBeenCalled();
    expect(onlyMediaRoom().connect).toHaveBeenCalledWith('wss://early.test', 'early');
    expect(call.getState().phase).toBe('connected');
  });

  it('asks again when the early grant could not be had', async () => {
    const { call } = setup({ grant: Promise.resolve(undefined) });

    await call.join();

    expect(requestSfuGrant).toHaveBeenCalledTimes(1);
    expect(onlyMediaRoom().connect).toHaveBeenCalledWith('wss://sfu.calls.test', 'jwt');
  });

  it('asks again when the early grant is for another service', async () => {
    const { call } = setup({
      grant: Promise.resolve({
        serviceUrl: 'https://rtc.elsewhere.test',
        grant: { url: 'wss://elsewhere.test', jwt: 'elsewhere' },
      }),
    });

    await call.join();

    expect(requestSfuGrant).toHaveBeenCalledWith(fakes.serviceUrl, expect.anything());
    expect(onlyMediaRoom().connect).toHaveBeenCalledWith('wss://sfu.calls.test', 'jwt');
  });
});

const OTHER = '@agent:calls.test';
const OTHER_DEVICE = 'AGENTDEVICE';
const OTHER_IDENTITY = `${OTHER}:${OTHER_DEVICE}`;
const OWN_IDENTITY = `${ME}:${DEVICE}`;

/** The identity this call's join handed the session, which its own keys come back with. */
const joinedAs = (session: FakeSession) => defined(session.join.mock.calls[0], 'a join')[0];

const emitKey = (
  session: FakeSession,
  key: number,
  keyIndex: number,
  membership: unknown,
  identity: string
) =>
  session.emit(
    MatrixRTCSessionEvent.EncryptionKeyChanged,
    new Uint8Array([key]),
    keyIndex,
    membership,
    identity
  );

describe('RoomCall media keys', () => {
  it("uses only this call's own keys, not those an earlier call's key manager still makes", async () => {
    const { call, session } = setup({ encrypted: true });
    await call.join();
    fakes.keys.length = 0;

    // The key manager of a call this device left stays with the room's session and keeps
    // rotating its key for the identity it joined with then.
    emitKey(session, 9, 3, { userId: ME, deviceId: DEVICE, memberId: OWN_IDENTITY }, OWN_IDENTITY);
    emitKey(session, 1, 0, joinedAs(session), OWN_IDENTITY);
    await settle();

    expect(fakes.keys.map(({ keyIndex, identity }) => [keyIndex, identity])).toEqual([
      [0, OWN_IDENTITY],
    ]);
  });

  it('sets its own key again once the media connected', async () => {
    const connected = pending();
    fakes.connect = () => connected.promise;
    const { call, session } = setup({ encrypted: true });
    const joining = call.join();
    await vi.waitFor(() => expect(session.join).toHaveBeenCalled());
    emitKey(session, 1, 0, joinedAs(session), OWN_IDENTITY);
    emitKey(session, 5, 2, { userId: OTHER, deviceId: OTHER_DEVICE }, OTHER_IDENTITY);
    await settle();
    fakes.keys.length = 0;

    connected.resolve();
    await joining;
    await settle();

    expect(fakes.keys.map(({ keyIndex, identity }) => [keyIndex, identity])).toEqual([
      [0, OWN_IDENTITY],
    ]);
  });

  it('sends its own key once more to a device whose key arrived, once per membership and key', async () => {
    const { call, session, mx } = setup({ encrypted: true });
    await call.join();
    session.setMemberships([membership(ME, DEVICE), membership(OTHER, OTHER_DEVICE, 7)]);
    emitKey(session, 1, 0, joinedAs(session), OWN_IDENTITY);
    // Nothing goes before a key of theirs shows their Olm session works.
    expect(sendCallKey).not.toHaveBeenCalled();

    emitKey(session, 5, 0, { userId: OTHER, deviceId: OTHER_DEVICE }, OTHER_IDENTITY);
    emitKey(session, 6, 1, { userId: OTHER, deviceId: OTHER_DEVICE }, OTHER_IDENTITY);
    session.setMemberships([membership(ME, DEVICE), membership(OTHER, OTHER_DEVICE, 7)]);

    expect(sendCallKey).toHaveBeenCalledTimes(1);
    expect(sendCallKey).toHaveBeenCalledWith(mx, {
      roomId: ROOM_ID,
      key: new Uint8Array([1]),
      keyIndex: 0,
      memberId: OWN_IDENTITY,
      to: expect.objectContaining({ userId: OTHER, deviceId: OTHER_DEVICE }),
    });

    // A new own key, and the same device joining again, each get it once more.
    emitKey(session, 2, 1, joinedAs(session), OWN_IDENTITY);
    session.setMemberships([membership(ME, DEVICE), membership(OTHER, OTHER_DEVICE, 9)]);
    expect(vi.mocked(sendCallKey).mock.calls.map(([, sent]) => [sent.keyIndex])).toEqual([
      [0],
      [1],
      [1],
    ]);
  });

  it('sends its own key to a device whose media joined, waiting for its membership', async () => {
    const { call, session } = setup({ encrypted: true });
    await call.join();
    emitKey(session, 1, 0, joinedAs(session), OWN_IDENTITY);

    onlyMediaRoom().emit('ParticipantConnected', { identity: OTHER_IDENTITY });
    expect(sendCallKey).not.toHaveBeenCalled();
    session.setMemberships([membership(ME, DEVICE), membership(OTHER, OTHER_DEVICE)]);

    expect(sendCallKey).toHaveBeenCalledTimes(1);
  });

  it('tries a failed send twice more, and sends nothing after the call is left', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(sendCallKey).mockRejectedValue(new Error('no Olm session'));
      const { call, session } = setup({ encrypted: true });
      await call.join();
      session.setMemberships([membership(ME, DEVICE), membership(OTHER, OTHER_DEVICE)]);
      emitKey(session, 1, 0, joinedAs(session), OWN_IDENTITY);
      emitKey(session, 5, 0, { userId: OTHER, deviceId: OTHER_DEVICE }, OTHER_IDENTITY);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(sendCallKey).toHaveBeenCalledTimes(3);

      await call.leave();
      emitKey(session, 7, 1, { userId: OTHER, deviceId: OTHER_DEVICE }, OTHER_IDENTITY);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(sendCallKey).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends nothing in a call without encryption', async () => {
    const { call, session } = setup();
    await call.join();
    session.setMemberships([membership(ME, DEVICE), membership(OTHER, OTHER_DEVICE)]);
    onlyMediaRoom().emit('ParticipantConnected', { identity: OTHER_IDENTITY });

    expect(sendCallKey).not.toHaveBeenCalled();
  });
});

const CAROL = '@carol:calls.test';
const CAROL_DEVICE = 'CAROLDEVICE';
const CAROL_IDENTITY = `${CAROL}:${CAROL_DEVICE}`;

/** A remote audio track as LiveKit hands it over: each attach makes one more element. */
const remoteAudioTrack = () => {
  const track = {
    kind: 'audio',
    attachedElements: [] as HTMLMediaElement[],
    attach: () => {
      const element = document.createElement('audio');
      track.attachedElements.push(element);
      return element;
    },
    detach: () => track.attachedElements.splice(0),
  };
  return track;
};

/** A device on the media server that publishes one audio track, and its subscription to it. */
const remoteDevice = (media: FakeMediaRoom, identity: string) => {
  const track = remoteAudioTrack();
  const publication = { trackSid: `TR_${identity}`, track };
  const participant = {
    identity,
    audioTrackPublications: new Map([[publication.trackSid, publication]]),
    getTrackPublication: () => undefined,
  };
  media.remoteParticipants.set(identity, participant);
  return { subscribe: () => media.emit('TrackSubscribed', track, publication, participant) };
};

const playing = () => document.querySelectorAll('[data-call-audio] audio').length;

describe("RoomCall members' media", () => {
  it('plays the sound of a device only while it is a member of the call', async () => {
    const { call, session } = setup();
    await call.join();
    const media = onlyMediaRoom();

    // A device on the media server that is not in the call is not heard.
    remoteDevice(media, CAROL_IDENTITY).subscribe();
    expect(playing()).toBe(0);

    // A member's media that arrives before its membership plays once the membership does.
    remoteDevice(media, OTHER_IDENTITY).subscribe();
    expect(playing()).toBe(0);
    session.setMemberships([membership(ME, DEVICE), membership(OTHER, OTHER_DEVICE)]);
    expect(playing()).toBe(1);
    session.setMemberships([membership(ME, DEVICE), membership(OTHER, OTHER_DEVICE)]);
    expect(playing()).toBe(1);

    // Once its membership is gone (it left the call, or the room) it is not heard any more.
    session.setMemberships([membership(ME, DEVICE)]);
    expect(playing()).toBe(0);
  });

  it("plays a member's sound once when LiveKit reports its subscription after the membership found it", async () => {
    const { call, session } = setup();
    await call.join();
    // While its connection resumes, LiveKit sets the subscribed track and reports it only later.
    const device = remoteDevice(onlyMediaRoom(), OTHER_IDENTITY);
    session.setMemberships([membership(ME, DEVICE), membership(OTHER, OTHER_DEVICE)]);
    expect(playing()).toBe(1);

    device.subscribe();

    expect(playing()).toBe(1);
  });

  it("plays a member's sound as soon as it arrives", async () => {
    const { call, session } = setup();
    session.memberships = [membership(OTHER, OTHER_DEVICE)];
    await call.join();

    remoteDevice(onlyMediaRoom(), OTHER_IDENTITY).subscribe();

    expect(playing()).toBe(1);
  });

  it('lets only the members of the call receive its media, from before its microphone opens', async () => {
    let sentWhile: string | undefined;
    fakes.connect = async (room) => {
      const media = room as FakeMediaRoom;
      media.localParticipant.setTrackSubscriptionPermissions.mockImplementation(() => {
        sentWhile = media.state;
      });
    };
    const { call, session } = setup();
    session.memberships = [membership(OTHER, OTHER_DEVICE)];
    await call.join();
    const { localParticipant } = onlyMediaRoom();
    const permissions = localParticipant.setTrackSubscriptionPermissions;
    const allowed = (...identities: string[]) =>
      identities.map((participantIdentity) => ({ participantIdentity, allowAll: true }));

    expect(permissions).toHaveBeenLastCalledWith(false, allowed(OTHER_IDENTITY));
    expect(sentWhile).toBe('connected');
    expect(permissions.mock.invocationCallOrder.at(-1)).toBeLessThan(
      defined(localParticipant.setMicrophoneEnabled.mock.invocationCallOrder[0], 'the microphone')
    );

    session.setMemberships([membership(OTHER, OTHER_DEVICE), membership(CAROL, CAROL_DEVICE)]);
    expect(permissions).toHaveBeenLastCalledWith(false, allowed(OTHER_IDENTITY, CAROL_IDENTITY));
    session.setMemberships([membership(CAROL, CAROL_DEVICE)]);
    expect(permissions).toHaveBeenLastCalledWith(false, allowed(CAROL_IDENTITY));
  });
});

describe('RoomCall rejoin after background disconnect', () => {
  it('keeps the call reconnecting while hidden, then rejoins on visible with a fresh grant, one membership, and current inputs', async () => {
    const earlyGrant = Promise.resolve({
      serviceUrl: fakes.serviceUrl,
      grant: { url: 'wss://early.calls.test', jwt: 'early-jwt' },
    });
    const { call, session } = setup({ grant: earlyGrant, notify: 'ring', video: true });
    await call.join();
    const firstMedia = onlyMediaRoom();
    expect(requestSfuGrant).not.toHaveBeenCalled();
    expect(session.join).toHaveBeenCalledTimes(1);

    // Change mic choice before the drop; camera stays on.
    await call.setMicrophone(false);
    setVisibility('hidden');
    firstMedia.emit('Disconnected');
    await settle();

    // Still the active call in reconnecting, device lock held, waiting for visible.
    expect(call.getState()).toMatchObject({
      phase: 'reconnecting',
      microphone: false,
      camera: true,
    });
    expect(call.getState().problem).toBeUndefined();
    expect(fakes.releases[0]).not.toHaveBeenCalled();
    expect(session.leave).toHaveBeenCalledTimes(1);
    expect(requestSfuGrant).not.toHaveBeenCalled();
    expect(mediaRooms()).toHaveLength(1);

    // Returning to visible rejoins the same call with a fresh SFU grant and no second ring.
    vi.mocked(requestSfuGrant).mockResolvedValueOnce({
      url: 'wss://fresh.calls.test',
      jwt: 'fresh-jwt',
    });
    setVisibility('visible');
    await settle();

    expect(requestSfuGrant).toHaveBeenCalledTimes(1);
    expect(session.join).toHaveBeenCalledTimes(2);
    expect(session.join).toHaveBeenLastCalledWith(
      { userId: ME, deviceId: DEVICE, memberId: `${ME}:${DEVICE}` },
      [{ type: 'livekit', livekit_service_url: fakes.serviceUrl, livekit_alias: ROOM_ID }],
      expect.objectContaining({ notificationType: undefined, callIntent: 'video' })
    );
    // The old membership was left before joining again, so there is only one membership.
    expect(defined(session.leave.mock.invocationCallOrder[0], 'the leave')).toBeLessThan(
      defined(session.join.mock.invocationCallOrder[1], 'the rejoin')
    );
    expect(mediaRooms()).toHaveLength(2);
    const secondMedia = defined(mediaRooms()[1], 'the rejoined LiveKit room');
    expect(secondMedia.connect).toHaveBeenCalledWith('wss://fresh.calls.test', 'fresh-jwt');
    expect(secondMedia.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
    expect(secondMedia.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true);
    expect(call.getState()).toMatchObject({
      phase: 'connected',
      microphone: false,
      camera: true,
    });
    expect(fakes.releases[0]).not.toHaveBeenCalled();
  });

  it('rejoins immediately when Disconnected arrives just after the page becomes visible again', async () => {
    const { call, session } = setup();
    await call.join();
    const firstMedia = onlyMediaRoom();

    setVisibility('hidden');
    setVisibility('visible');
    firstMedia.emit('Disconnected');
    await settle();

    expect(mediaRooms()).toHaveLength(2);
    expect(session.join).toHaveBeenCalledTimes(2);
    expect(call.getState().phase).toBe('connected');
  });

  it('replaces the encryption worker and exchanges peer and fresh local keys on the rejoined provider', async () => {
    const { call, session, mx } = setup({ encrypted: true });
    await call.join();
    const firstMedia = onlyMediaRoom();
    const firstProvider = defined(firstMedia.options.encryption?.keyProvider, 'the first provider');
    const firstWorker = defined(fakes.workers[0], 'the first worker');

    setVisibility('hidden');
    firstMedia.emit('Disconnected');
    await settle();

    expect(firstWorker.terminate).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await settle();

    expect(fakes.workers).toHaveLength(2);
    const secondMedia = defined(mediaRooms()[1], 'the rejoined LiveKit room');
    const secondProvider = defined(
      secondMedia.options.encryption?.keyProvider,
      'the rejoined provider'
    );
    expect(secondProvider).not.toBe(firstProvider);
    expect(secondMedia.setE2EEEnabled).toHaveBeenCalledWith(true);
    expect(session.join).toHaveBeenLastCalledWith(
      expect.objectContaining({ deviceId: DEVICE }),
      expect.anything(),
      expect.objectContaining({ manageMediaKeys: true })
    );
    expect(call.getState().phase).toBe('connected');

    const rejoinedOwn = defined(session.join.mock.calls[1], 'the rejoin call')[0];
    session.setMemberships([membership(ME, DEVICE), membership(OTHER, OTHER_DEVICE, 10)]);
    emitKey(session, 9, 0, rejoinedOwn, OWN_IDENTITY);
    emitKey(session, 4, 2, { userId: OTHER, deviceId: OTHER_DEVICE }, OTHER_IDENTITY);
    await settle();

    expect(secondProvider.keys).toEqual([
      { key: new Uint8Array([9]), keyIndex: 0, identity: OWN_IDENTITY },
      { key: new Uint8Array([4]), keyIndex: 2, identity: OTHER_IDENTITY },
    ]);
    expect(firstProvider.keys).toEqual([]);
    expect(sendCallKey).toHaveBeenCalledWith(mx, {
      roomId: ROOM_ID,
      key: new Uint8Array([9]),
      keyIndex: 0,
      memberId: OWN_IDENTITY,
      to: expect.objectContaining({ userId: OTHER, deviceId: OTHER_DEVICE }),
    });
  });

  it('restores real inputs rather than replaying a failed camera enable request', async () => {
    const { call } = setup({ microphone: true, video: false });
    await call.join();
    const firstMedia = onlyMediaRoom();
    firstMedia.localParticipant.setCameraEnabled.mockRejectedValueOnce(new Error('no camera'));
    await call.setCamera(true);
    expect(call.getState().camera).toBe(false);

    setVisibility('hidden');
    firstMedia.emit('Disconnected');
    await settle();
    setVisibility('visible');
    await settle();

    const secondMedia = defined(mediaRooms()[1], 'the rejoined LiveKit room');
    expect(secondMedia.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
    expect(secondMedia.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(call.getState()).toMatchObject({ phase: 'connected', microphone: true, camera: false });
  });

  it('waits for the old session leave to confirm before rejoining, and fails if leave is unconfirmed', async () => {
    const { call, session } = setup();
    await call.join();
    const firstLeave = pending<boolean>();
    session.leave.mockImplementationOnce(() => {
      session.joined = false;
      return firstLeave.promise;
    });

    setVisibility('hidden');
    onlyMediaRoom().emit('Disconnected');
    setVisibility('visible');
    await settle();

    // Must not start rejoining until the old membership manager confirms leave.
    expect(requestSfuGrant).toHaveBeenCalledTimes(1);
    expect(session.join).toHaveBeenCalledTimes(1);
    expect(call.getState().phase).toBe('reconnecting');

    firstLeave.resolve(true);
    await settle();
    expect(session.join).toHaveBeenCalledTimes(2);
    expect(call.getState().phase).toBe('connected');

    // An unconfirmed leave fails the call instead of joining over it.
    session.leave.mockResolvedValueOnce(false);
    setVisibility('hidden');
    defined(mediaRooms()[1], 'the second LiveKit room').emit('Disconnected');
    setVisibility('visible');
    await settle();
    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'connection' });
    expect(session.join).toHaveBeenCalledTimes(2);
    expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
  });

  it('awaits an in-flight background leave when the user leaves the call', async () => {
    const { call, session } = setup();
    await call.join();
    const firstLeave = pending<boolean>();
    session.leave.mockImplementationOnce(() => {
      session.joined = false;
      return firstLeave.promise;
    });

    setVisibility('hidden');
    onlyMediaRoom().emit('Disconnected');
    await settle();

    let ended = false;
    const leaving = call.leave().then(() => {
      ended = true;
    });
    await settle();
    expect(ended).toBe(false);

    firstLeave.resolve(true);
    await leaving;
    expect(ended).toBe(true);
    expect(call.getState().phase).toBe('ended');
    expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
  });

  it('fails immediately on terminal disconnect reasons even when the page was hidden', async () => {
    const { call, session } = setup();
    await call.join();

    setVisibility('hidden');
    onlyMediaRoom().emit('Disconnected', DisconnectReason.DUPLICATE_IDENTITY);
    await settle();

    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'connection' });
    expect(mediaRooms()).toHaveLength(1);
    expect(session.join).toHaveBeenCalledTimes(1);
    expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
  });

  it('rejoins after the media server shut down while the page was hidden', async () => {
    const { call, session } = setup();
    await call.join();

    setVisibility('hidden');
    onlyMediaRoom().emit('Disconnected', DisconnectReason.SERVER_SHUTDOWN);
    await settle();
    expect(call.getState()).toMatchObject({ phase: 'reconnecting', problem: undefined });

    setVisibility('visible');
    await settle();
    expect(mediaRooms()).toHaveLength(2);
    expect(session.join).toHaveBeenCalledTimes(2);
    expect(call.getState().phase).toBe('connected');
  });

  it('never reopens microphone or camera while hidden again during rejoin', async () => {
    const { call, session } = setup({ microphone: true, video: true });
    await call.join();

    setVisibility('hidden');
    onlyMediaRoom().emit('Disconnected');
    await settle();

    // Hide again while the fresh SFU grant is in flight: waits before joining.
    const grant = pending<{ url: string; jwt: string }>();
    vi.mocked(requestSfuGrant).mockReturnValueOnce(grant.promise);
    setVisibility('visible');
    await settle();
    setVisibility('hidden');
    grant.resolve({ url: 'wss://fresh.calls.test', jwt: 'fresh-jwt' });
    await settle();
    expect(session.join).toHaveBeenCalledTimes(1);
    expect(mediaRooms()).toHaveLength(1);

    // Visible again lets connect start; hide again during connect: waits before opening inputs.
    const connecting = pending();
    fakes.connect = () => connecting.promise;
    setVisibility('visible');
    await settle();
    expect(mediaRooms()).toHaveLength(2);
    const secondMedia = defined(mediaRooms()[1], 'the rejoined LiveKit room');
    setVisibility('hidden');
    connecting.resolve();
    await settle();
    // The rejoin is done once its media connected; only the inputs wait for the page.
    expect(call.getState().phase).toBe('connected');
    expect(secondMedia.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(secondMedia.localParticipant.setCameraEnabled).not.toHaveBeenCalled();

    setVisibility('visible');
    await settle();
    expect(call.getState().phase).toBe('connected');
    expect(secondMedia.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(secondMedia.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true);
  });

  it('keeps a rejoined call whose page hid while it connected, past the deadline and through a second drop', async () => {
    vi.useFakeTimers();
    try {
      const { call, session } = setup();
      await call.join();
      const hideWhileConnecting = async () => {
        const connecting = pending();
        fakes.connect = () => connecting.promise;
        setVisibility('visible');
        await vi.advanceTimersByTimeAsync(0);
        setVisibility('hidden');
        connecting.resolve();
        await vi.advanceTimersByTimeAsync(0);
      };

      setVisibility('hidden');
      onlyMediaRoom().emit('Disconnected');
      await vi.advanceTimersByTimeAsync(0);
      await hideWhileConnecting();
      const secondMedia = defined(mediaRooms()[1], 'the rejoined LiveKit room');

      // The deadline ended with the connect: the connected call is not given up.
      await vi.advanceTimersByTimeAsync(RESUME_WINDOW_MS);
      expect(call.getState()).toMatchObject({ phase: 'connected', problem: undefined });
      expect(fakes.releases[0]).not.toHaveBeenCalled();

      // A drop in the background again is the next rejoin, not the end of the call.
      secondMedia.emit('Disconnected');
      await vi.advanceTimersByTimeAsync(0);
      expect(call.getState()).toMatchObject({ phase: 'reconnecting', problem: undefined });
      fakes.connect = undefined;
      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(0);
      const thirdMedia = defined(mediaRooms()[2], 'the LiveKit room of the second rejoin');
      expect(call.getState().phase).toBe('connected');
      expect(session.join).toHaveBeenCalledTimes(3);
      expect(secondMedia.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
      expect(thirdMedia.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts nothing against the call when an input or device change of the dropped room settles late', async () => {
    const { call } = setup();
    await call.join();
    const firstMedia = onlyMediaRoom();
    const camera = pending();
    firstMedia.localParticipant.setCameraEnabled.mockImplementationOnce(() => camera.promise);
    const speaker = pending<boolean>();
    firstMedia.switchActiveDevice.mockImplementationOnce(() => speaker.promise);
    const toggling = call.setCamera(true);
    const switching = call.setDevice('audiooutput', 'speaker-2');

    setVisibility('hidden');
    firstMedia.emit('Disconnected');
    await settle();
    camera.reject(new Error('room closed'));
    speaker.reject(new Error('room closed'));
    await Promise.all([toggling, switching]);

    expect(call.getState()).toMatchObject({
      phase: 'reconnecting',
      camera: true,
      problem: undefined,
    });
    setVisibility('visible');
    await settle();
    const secondMedia = defined(mediaRooms()[1], 'the rejoined LiveKit room');
    expect(secondMedia.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true);
    expect(call.getState()).toMatchObject({ phase: 'connected', camera: true, problem: undefined });
  });

  it('keeps the camera closed when the page hides during the microphone restore, until it shows again', async () => {
    vi.useFakeTimers();
    try {
      const { call } = setup({ microphone: true, video: true });
      await call.join();

      setVisibility('hidden');
      onlyMediaRoom().emit('Disconnected');
      await vi.advanceTimersByTimeAsync(0);

      const microphone = pending();
      fakes.connect = async (room) => {
        const { localParticipant } = room as FakeMediaRoom;
        localParticipant.setMicrophoneEnabled.mockImplementationOnce(() => microphone.promise);
      };
      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(0);
      const secondMedia = defined(mediaRooms()[1], 'the rejoined LiveKit room');
      expect(call.getState().phase).toBe('connected');
      expect(secondMedia.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);

      setVisibility('hidden');
      microphone.resolve();
      // The rejoin's deadline ended when its media connected: the call stays, without a camera.
      await vi.advanceTimersByTimeAsync(RESUME_WINDOW_MS);
      expect(secondMedia.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
      expect(call.getState()).toMatchObject({ phase: 'connected', camera: true });
      expect(fakes.releases[0]).not.toHaveBeenCalled();

      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(0);
      expect(secondMedia.localParticipant.setCameraEnabled).toHaveBeenCalledTimes(1);
      expect(secondMedia.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens no camera on a room that dropped, or after the camera was turned off, while it waited for the page', async () => {
    const { call } = setup({ microphone: true, video: true });
    await call.join();
    const hideDuringMicrophoneRestore = async () => {
      const microphone = pending();
      fakes.connect = async (room) => {
        const { localParticipant } = room as FakeMediaRoom;
        localParticipant.setMicrophoneEnabled.mockImplementationOnce(() => microphone.promise);
      };
      setVisibility('visible');
      await settle();
      setVisibility('hidden');
      microphone.resolve();
      await settle();
    };

    setVisibility('hidden');
    onlyMediaRoom().emit('Disconnected');
    await settle();
    await hideDuringMicrophoneRestore();
    const secondMedia = defined(mediaRooms()[1], 'the rejoined LiveKit room');

    // The rejoined room drops in the background too: the camera opens on the next room only.
    secondMedia.emit('Disconnected');
    await settle();
    await hideDuringMicrophoneRestore();
    const thirdMedia = defined(mediaRooms()[2], 'the LiveKit room of the second rejoin');
    expect(secondMedia.localParticipant.setCameraEnabled).not.toHaveBeenCalled();

    await call.setCamera(false);
    setVisibility('visible');
    await settle();
    expect(secondMedia.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
    expect(thirdMedia.localParticipant.setCameraEnabled.mock.calls).toEqual([[false]]);
    expect(call.getState()).toMatchObject({ phase: 'connected', camera: false });
  });

  it('fails without a second join when the old membership manager reports an error, then a finished leave', async () => {
    const { call, session } = setup();
    await call.join();
    const firstLeave = pending<boolean>();
    session.leave.mockImplementationOnce(() => {
      session.joined = false;
      return firstLeave.promise;
    });

    setVisibility('hidden');
    onlyMediaRoom().emit('Disconnected');
    setVisibility('visible');
    await settle();
    expect(call.getState().phase).toBe('reconnecting');

    // The SDK reports the manager's error first and then resolves the leave with `true`.
    session.emit(MatrixRTCSessionEvent.MembershipManagerError, new Error('leave event refused'));
    firstLeave.resolve(true);
    await settle();

    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'connection' });
    expect(session.join).toHaveBeenCalledTimes(1);
    expect(mediaRooms()).toHaveLength(1);
    expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
  });

  it('fails without a second join while the session still lists the old membership', async () => {
    vi.useFakeTimers();
    try {
      const { call, session } = setup();
      await call.join();
      session.memberships = [membership(ME, DEVICE)];

      setVisibility('hidden');
      onlyMediaRoom().emit('Disconnected');
      setVisibility('visible');
      // The leave was confirmed: nothing is withdrawn again, the listing only has to follow.
      await vi.advanceTimersByTimeAsync(RESUME_WINDOW_MS - 1_000);
      expect(withdrawOwnMemberships).not.toHaveBeenCalled();
      expect(call.getState().phase).toBe('reconnecting');

      await vi.advanceTimersByTimeAsync(1_000);
      expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'connection' });
      expect(session.join).toHaveBeenCalledTimes(1);
      expect(mediaRooms()).toHaveLength(1);
      expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends the wait for the old membership to go when the user hangs up', async () => {
    vi.useFakeTimers();
    try {
      const { call, session } = setup();
      await call.join();
      session.memberships = [membership(ME, DEVICE)];

      setVisibility('hidden');
      onlyMediaRoom().emit('Disconnected');
      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(call.getState().phase).toBe('reconnecting');

      await call.leave();
      expect(call.getState()).toMatchObject({ phase: 'ended', problem: undefined });
      expect(session.listenerCount(MatrixRTCSessionEvent.MembershipsChanged)).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(session.join).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejoins once the session drops the old membership, also later than the leftover wait of a first join', async () => {
    vi.useFakeTimers();
    try {
      const { call, session } = setup();
      await call.join();
      session.memberships = [membership(ME, DEVICE)];

      setVisibility('hidden');
      onlyMediaRoom().emit('Disconnected');
      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(30_000);
      expect(session.join).toHaveBeenCalledTimes(1);

      session.setMemberships([]);
      await vi.advanceTimersByTimeAsync(0);
      expect(withdrawOwnMemberships).not.toHaveBeenCalled();
      expect(session.join).toHaveBeenCalledTimes(2);
      expect(call.getState().phase).toBe('connected');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores late events from the retired room after rejoining', async () => {
    const { call, session } = setup();
    await call.join();
    const firstMedia = onlyMediaRoom();
    // LiveKit has listeners of its own on the room, which the call leaves there.
    const liveKitCleanup = vi.fn();
    firstMedia.once('Disconnected', liveKitCleanup);
    const liveKitListener = vi.fn();
    firstMedia.on('TrackSubscribed', liveKitListener);

    setVisibility('hidden');
    firstMedia.emit('Disconnected');
    await settle();
    expect(firstMedia.dispose).toHaveBeenCalledTimes(1);
    expect(liveKitCleanup).toHaveBeenCalledTimes(1);
    expect(firstMedia.eventNames()).toEqual(['TrackSubscribed']);
    expect(firstMedia.listeners('TrackSubscribed')).toEqual([liveKitListener]);

    setVisibility('visible');
    await settle();
    expect(call.getState().phase).toBe('connected');
    const currentTrack = call.getState().microphoneTrack;

    session.setMemberships([membership(ME, DEVICE), membership(OTHER, OTHER_DEVICE)]);
    remoteDevice(firstMedia, OTHER_IDENTITY).subscribe();
    firstMedia.emit('LocalTrackPublished', inputPublication('microphone', inputTrack('stale-mic')));
    firstMedia.emit('Disconnected');
    await settle();

    expect(playing()).toBe(0);
    expect(call.getState().microphoneTrack).toBe(currentTrack);
    expect(call.getState().phase).toBe('connected');
    expect(call.getState().problem).toBeUndefined();
  });

  it('honors input toggles made while reconnecting once the rejoin connects', async () => {
    const { call } = setup({ microphone: true, video: false });
    await call.join();

    setVisibility('hidden');
    onlyMediaRoom().emit('Disconnected');
    await settle();

    await call.setMicrophone(false);
    await call.setCamera(true);
    setVisibility('visible');
    await settle();

    const secondMedia = defined(mediaRooms()[1], 'the rejoined LiveKit room');
    expect(secondMedia.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
    expect(secondMedia.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true);
    expect(call.getState()).toMatchObject({ phase: 'connected', microphone: false, camera: true });
  });

  it('fails with the connection problem when staying hidden for RESUME_WINDOW_MS after Disconnected', async () => {
    vi.useFakeTimers();
    try {
      const { call, session } = setup();
      await call.join();

      setVisibility('hidden');
      await vi.advanceTimersByTimeAsync(30_000);
      onlyMediaRoom().emit('Disconnected');
      await vi.advanceTimersByTimeAsync(RESUME_WINDOW_MS - 1_000);
      expect(call.getState().phase).toBe('reconnecting');
      expect(fakes.releases[0]).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1_000);
      expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'connection' });
      expect(fakes.releases[0]).toHaveBeenCalledTimes(1);

      // Coming back later does not rejoin a call that already gave up.
      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(0);
      expect(mediaRooms()).toHaveLength(1);
      expect(session.join).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails and releases the lock when a rejoin grant stalls past RESUME_WINDOW_MS after becoming visible', async () => {
    vi.useFakeTimers();
    try {
      const { call, session } = setup();
      await call.join();

      setVisibility('hidden');
      onlyMediaRoom().emit('Disconnected');
      await vi.advanceTimersByTimeAsync(30_000);

      const stalledGrant = pending<{ url: string; jwt: string }>();
      vi.mocked(requestSfuGrant).mockReturnValueOnce(stalledGrant.promise);
      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(RESUME_WINDOW_MS - 31_000);
      expect(call.getState().phase).toBe('reconnecting');
      expect(fakes.releases[0]).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1_000);
      expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'connection' });
      expect(fakes.releases[0]).toHaveBeenCalledTimes(1);

      // Settling the stalled grant after expiry does not open a room or membership.
      stalledGrant.resolve({ url: 'wss://late.calls.test', jwt: 'late-jwt' });
      await vi.advanceTimersByTimeAsync(0);
      expect(mediaRooms()).toHaveLength(1);
      expect(session.join).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails with the connection problem when the rejoin grant or media connect fails', async () => {
    const { call, session } = setup();
    await call.join();

    setVisibility('hidden');
    onlyMediaRoom().emit('Disconnected');
    await settle();
    expect(call.getState().phase).toBe('reconnecting');

    vi.mocked(requestSfuGrant).mockRejectedValueOnce(new Error('sfu unreachable'));
    setVisibility('visible');
    await settle();

    expect(requestSfuGrant).toHaveBeenCalledTimes(2);
    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'connection' });
    expect(session.join).toHaveBeenCalledTimes(1);
    expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
  });

  it('fails with the connection problem if the rejoin itself disconnects during connect', async () => {
    const { call, session } = setup();
    await call.join();

    setVisibility('hidden');
    onlyMediaRoom().emit('Disconnected');
    await settle();

    fakes.connect = async (room) => {
      (room as FakeMediaRoom).emit('Disconnected');
      throw new Error('dropped during rejoin');
    };
    setVisibility('visible');
    await settle();

    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'connection' });
    expect(session.leave).toHaveBeenCalledTimes(2);
    expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
  });

  it('ends normally when the user leaves while reconnecting', async () => {
    const { call, session } = setup();
    await call.join();

    setVisibility('hidden');
    onlyMediaRoom().emit('Disconnected');
    await settle();
    expect(call.getState().phase).toBe('reconnecting');

    await call.leave();
    expect(call.getState().phase).toBe('ended');
    expect(call.getState().problem).toBeUndefined();
    expect(fakes.releases[0]).toHaveBeenCalledTimes(1);

    // Becoming visible after leaving does not start a rejoin.
    setVisibility('visible');
    await settle();
    expect(mediaRooms()).toHaveLength(1);
    expect(session.join).toHaveBeenCalledTimes(1);
  });

  it('stops cleanly when the user leaves while a rejoin is in flight', async () => {
    const { call, session } = setup();
    await call.join();

    setVisibility('hidden');
    onlyMediaRoom().emit('Disconnected');
    await settle();

    const grant = pending<{ url: string; jwt: string }>();
    vi.mocked(requestSfuGrant).mockReturnValueOnce(grant.promise);
    setVisibility('visible');
    await settle();
    expect(requestSfuGrant).toHaveBeenCalledTimes(2);

    await call.leave();
    grant.resolve({ url: 'wss://fresh.calls.test', jwt: 'fresh-jwt' });
    await settle();

    expect(call.getState().phase).toBe('ended');
    expect(call.getState().problem).toBeUndefined();
    expect(mediaRooms()).toHaveLength(1);
    expect(session.join).toHaveBeenCalledTimes(1);
    expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
  });

  it('fails immediately on a drop long after the page came back from the background', async () => {
    vi.useFakeTimers();
    try {
      const { call, session } = setup();
      await call.join();

      setVisibility('hidden');
      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(61_000);
      onlyMediaRoom().emit('Disconnected');
      await vi.advanceTimersByTimeAsync(0);

      expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'connection' });
      expect(session.join).toHaveBeenCalledTimes(1);
      expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps failing immediately when Disconnected happens while the page stayed visible', async () => {
    const { call, session } = setup();
    await call.join();
    const media = onlyMediaRoom();

    // Even after an earlier brief background switch that LiveKit itself reconnected from.
    setVisibility('hidden');
    setVisibility('visible');
    media.emit('Reconnecting');
    media.emit('Reconnected');

    media.emit('Disconnected');
    await settle();

    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'connection' });
    expect(mediaRooms()).toHaveLength(1);
    expect(session.join).toHaveBeenCalledTimes(1);
    expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
  });
});

describe('RoomCall iOS background screen share, track ended, and dead-device warnings', () => {
  const IPHONE = { userAgent: 'iPhone OS 18_0', platform: 'iPhone', maxTouchPoints: 5 };
  const DESKTOP = { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 0 };
  type FakePub = ReturnType<typeof inputPublication>;
  const pubOf = (media: FakeMediaRoom, source: string) =>
    defined(media.localParticipant.trackPublications.get(source) as FakePub | undefined, source);
  const endTrack = (pub: FakePub) => {
    pub.track.mediaStreamTrack.readyState = 'ended';
    pub.track.mediaStreamTrack.dispatchEvent(new Event('ended'));
  };
  const joinCall = async (opts?: Parameters<typeof setup>[0]) => {
    const res = setup(opts);
    await res.call.join();
    return { ...res, media: onlyMediaRoom() };
  };
  const shareState = (call: RoomCall) => ({
    on: call.getState().screenShare,
    notice: !!call.getState().screenShareStoppedInBackground,
  });

  afterEach(() => vi.unstubAllGlobals());

  it('mutes then unpublishes iOS share on hide, keeps notice on picker cancel, clears on share or leave', async () => {
    vi.stubGlobal('navigator', IPHONE);
    const { call, media } = await joinCall();
    await call.setScreenShare(true);
    const order: string[] = [];
    const muting = pending<void>();
    vi.spyOn(pubOf(media, 'screen_share'), 'mute').mockImplementationOnce(async () => {
      await muting.promise;
      order.push('mute');
    });
    const base = media.localParticipant.setScreenShareEnabled.getMockImplementation();
    media.localParticipant.setScreenShareEnabled.mockImplementationOnce(async (on: boolean) => {
      order.push(on ? 'publish' : 'unpublish');
      return base?.(on);
    });
    setVisibility('hidden');
    await settle();
    expect(order).toEqual([]);
    muting.resolve();
    await settle();
    expect(order).toEqual(['mute', 'unpublish']);
    expect(shareState(call)).toEqual({ on: false, notice: true });

    // Visible does not auto-restart; picker cancel keeps the notice until a share starts.
    setVisibility('visible');
    media.localParticipant.setScreenShareEnabled.mockRejectedValueOnce(new Error('NotAllowed'));
    await call.setScreenShare(true);
    expect(shareState(call)).toEqual({ on: false, notice: true });
    await call.setScreenShare(true);
    expect(shareState(call)).toEqual({ on: true, notice: false });
    setVisibility('hidden');
    await settle();
    await call.leave();
    expect(shareState(call).notice).toBe(false);
  });

  it('stops a pending iOS share that hid in flight, and leaves desktop sharing alone', async () => {
    vi.stubGlobal('navigator', IPHONE);
    const { call, media } = await joinCall();
    const base = media.localParticipant.setScreenShareEnabled.getMockImplementation();
    const starting = pending<void>();
    media.localParticipant.setScreenShareEnabled.mockImplementationOnce(async () => {
      await starting.promise;
      return base?.(true);
    });
    const sharePromise = call.setScreenShare(true);
    setVisibility('hidden');
    setVisibility('visible');
    starting.resolve();
    await sharePromise;
    await settle();
    expect(shareState(call)).toEqual({ on: false, notice: true });

    vi.stubGlobal('navigator', DESKTOP);
    await call.setScreenShare(true);
    setVisibility('hidden');
    await settle();
    expect(shareState(call)).toEqual({ on: true, notice: false });
  });

  it('clears a remote screen tile when TrackUnsubscribed fires before publication.track clears', async () => {
    const { call, session } = setup();
    session.memberships.push(membership('@bob:calls.test', 'BOBDEV'));
    await call.join();
    const media = onlyMediaRoom();
    const screenTrack = { kind: 'video', detach: () => [] };
    const screenPub: { isMuted: boolean; track?: typeof screenTrack } = {
      isMuted: false,
      track: screenTrack,
    };
    media.remoteParticipants.set('@bob:calls.test:BOBDEV', {
      identity: '@bob:calls.test:BOBDEV',
      isSpeaking: false,
      isMicrophoneEnabled: true,
      audioTrackPublications: new Map(),
      getTrackPublication: (source: string) => (source === 'screen_share' ? screenPub : undefined),
    });
    media.emit('ParticipantConnected', { identity: '@bob:calls.test:BOBDEV' });
    expect(call.getState().participants[1]?.screen).toBe(screenTrack);
    media.emit('TrackUnsubscribed', screenTrack);
    screenPub.track = undefined;
    await Promise.resolve();
    expect(call.getState().participants[1]?.screen).toBeUndefined();
  });

  it('warns on ended mic/camera, keeps notice on failed retry, clears on recovery, ignores user off', async () => {
    const { call, media } = await joinCall({ microphone: true, video: true });
    const micPub = pubOf(media, 'microphone');
    endTrack(micPub);
    endTrack(pubOf(media, 'camera'));
    expect(call.getState()).toMatchObject({
      microphone: false,
      camera: false,
      microphoneTrack: undefined,
      microphoneStopped: true,
      cameraStopped: true,
    });
    expect(call.getState().participants[0]?.video).toBeUndefined();

    const muteSpy = vi.spyOn(micPub, 'mute');
    media.localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(new Error('NotFoundError'));
    await call.setMicrophone(true);
    expect(muteSpy).toHaveBeenCalledOnce();
    expect(call.getState()).toMatchObject({ microphone: false, microphoneStopped: true });
    media.localParticipant.setMicrophoneEnabled.mockImplementationOnce(async () => {
      micPub.isMuted = false;
      micPub.track.mediaStreamTrack = inputTrack('mic-recovered');
      return micPub;
    });
    await call.setMicrophone(true);
    expect(call.getState()).toMatchObject({ microphone: true, microphoneStopped: false });

    await call.setMicrophone(false);
    endTrack(micPub);
    expect(call.getState().microphoneStopped).toBeFalsy();
  });

  it('dismisses a stopped-input notice without blocking LiveKit auto-recovery', async () => {
    const { call, media } = await joinCall({ microphone: true });
    const pub = pubOf(media, 'microphone');
    endTrack(pub);
    call.dismissStoppedInput('microphone');
    expect(call.getState()).toMatchObject({ microphone: false, microphoneStopped: false });
    pub.track.mediaStreamTrack = inputTrack('mic-auto-recovered');
    media.emit('LocalTrackPublished', pub);
    expect(pub.isMuted).toBe(false);
    expect(call.getState()).toMatchObject({ microphone: true, microphoneStopped: false });
  });

  it('keeps an existing dead-mic warning across #770 rejoin without false warnings on teardown', async () => {
    const { call, session, media } = await joinCall({ microphone: true, video: true });
    setVisibility('hidden');
    endTrack(pubOf(media, 'microphone'));
    media.emit('Disconnected');
    await settle();
    endTrack(pubOf(media, 'camera'));
    expect(call.getState()).toMatchObject({ phase: 'reconnecting', microphoneStopped: true });
    expect(call.getState().cameraStopped).toBeFalsy();

    setVisibility('visible');
    session.setMemberships([]);
    await settle();
    await settle();
    expect(call.getState()).toMatchObject({
      phase: 'connected',
      microphone: false,
      microphoneStopped: true,
    });
    await call.setMicrophone(true);
    expect(call.getState()).toMatchObject({ microphone: true, microphoneStopped: false });
  });
});

describe('RoomCall native whole-phone screen share and companion folding', () => {
  const IPHONE = { userAgent: 'iPhone OS 18_0', platform: 'iPhone', maxTouchPoints: 5 };

  afterEach(() => vi.unstubAllGlobals());

  it('raises delayedLeaveEventDelayMs to 60s without overriding restart interval only when native screen share is available', async () => {
    const desktop = setup();
    await desktop.call.join();
    const desktopOpts = desktop.session.join.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(desktopOpts.delayedLeaveEventDelayMs).toBeUndefined();
    expect(desktopOpts.delayedLeaveEventRestartMs).toBeUndefined();
    await desktop.call.leave();

    fakes.nativeScreenShareAvailable = true;
    const ios = setup();
    await ios.call.join();
    const iosOpts = ios.session.join.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(iosOpts.delayedLeaveEventDelayMs).toBe(60_000);
    expect(iosOpts.delayedLeaveEventRestartMs).toBeUndefined();
    await ios.call.leave();
  });

  it('folds screen-only companions onto their primary participant without hiding real second devices', async () => {
    const { call, session } = setup();
    session.memberships.push(
      membership(ME, `${DEVICE}-screen`, 2, {
        'chat.mindroom.screen_only': true,
        'chat.mindroom.screen_parent_device_id': DEVICE,
      }),
      membership('@bob:example.com', 'BOB_PHONE', 3),
      membership('@bob:example.com', 'BOB_PHONE-screen', 4, {
        'chat.mindroom.screen_only': true,
        'chat.mindroom.screen_parent_device_id': 'BOB_PHONE',
      }),
      membership('@bob:example.com', 'BOB_LAPTOP', 5)
    );
    await call.join();
    const media = onlyMediaRoom();
    const myScreenTrack = { kind: 'video', id: 'my-screen', detach: () => [] };
    const bobScreenTrack = { kind: 'video', id: 'bob-screen', detach: () => [] };
    const remoteWithScreen = (identity: string, screenTrack?: unknown) => ({
      identity,
      isSpeaking: false,
      isMicrophoneEnabled: true,
      audioTrackPublications: new Map(),
      getTrackPublication: (source: string) =>
        source === 'screen_share' && screenTrack ? { isMuted: false, track: screenTrack } : undefined,
    });
    media.remoteParticipants.set(
      `${ME}:${DEVICE}-screen`,
      remoteWithScreen(`${ME}:${DEVICE}-screen`, myScreenTrack)
    );
    media.remoteParticipants.set(
      '@bob:example.com:BOB_PHONE',
      remoteWithScreen('@bob:example.com:BOB_PHONE')
    );
    media.remoteParticipants.set(
      '@bob:example.com:BOB_PHONE-screen',
      remoteWithScreen('@bob:example.com:BOB_PHONE-screen', bobScreenTrack)
    );
    media.remoteParticipants.set(
      '@bob:example.com:BOB_LAPTOP',
      remoteWithScreen('@bob:example.com:BOB_LAPTOP')
    );
    media.emit('ParticipantConnected', { identity: '@bob:example.com:BOB_PHONE-screen' });

    const participants = call.getState().participants;
    expect(participants.map((p) => p.key)).toEqual([
      `${ME}:${DEVICE}`,
      '@bob:example.com:BOB_PHONE',
      '@bob:example.com:BOB_LAPTOP',
    ]);
    expect(participants[0]?.local).toBe(true);
    expect(participants[0]?.screen).toBe(myScreenTrack);
    expect(participants[1]?.screen).toBe(bobScreenTrack);
    expect(participants[2]?.screen).toBeUndefined();

    // When a primary flickers out, unmatched companions keep screenParentDeviceId (explicit or inferred).
    session.setMemberships([
      membership('@bob:example.com', 'BOB_PHONE-screen', 4, {
        'chat.mindroom.screen_only': true,
        'chat.mindroom.screen_parent_device_id': 'BOB_PHONE',
      }),
      membership('@carol:example.com', 'CAROL_PHONE-screen', 6, {
        'chat.mindroom.screen_only': true,
      }),
    ]);
    const afterFlicker = call.getState().participants;
    expect(afterFlicker.find((p) => p.key === '@bob:example.com:BOB_PHONE-screen')).toMatchObject({
      screen: bobScreenTrack,
      screenParentDeviceId: 'BOB_PHONE',
    });
    expect(afterFlicker.find((p) => p.key === '@carol:example.com:CAROL_PHONE-screen')).toMatchObject(
      { screenParentDeviceId: 'CAROL_PHONE' }
    );
  });

  it('skips resending primary media keys to screen-only companion memberships', async () => {
    const { call, session } = setup({ encrypted: true });
    session.memberships.push(
      membership('@bob:example.com', 'BOB_PHONE', 3),
      membership('@bob:example.com', 'BOB_PHONE-screen', 4, {
        'chat.mindroom.screen_only': true,
        'chat.mindroom.screen_parent_device_id': 'BOB_PHONE',
      })
    );
    await call.join();
    const ownMembership = session.join.mock.calls[0]?.[0];
    session.emit(
      MatrixRTCSessionEvent.EncryptionKeyChanged,
      new Uint8Array(32),
      0,
      ownMembership,
      `${ME}:${DEVICE}`
    );
    const media = onlyMediaRoom();
    media.emit('ParticipantConnected', { identity: '@bob:example.com:BOB_PHONE' });
    media.emit('ParticipantConnected', { identity: '@bob:example.com:BOB_PHONE-screen' });
    await settle();

    expect(sendCallKey).toHaveBeenCalledTimes(1);
    expect(sendCallKey).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: expect.objectContaining({ userId: '@bob:example.com', deviceId: 'BOB_PHONE' }),
      })
    );
  });

  it('keeps native whole-phone screen share running in background on iOS and stops cleanly via setScreenShare(false) or leave()', async () => {
    vi.stubGlobal('navigator', IPHONE);
    fakes.nativeScreenShareAvailable = true;
    const { call, mx } = setup({ encrypted: true });
    await call.join();

    await call.setNativeScreenShare(true);
    fakes.nativeScreenListener?.({ generation: 1, state: 'broadcasting' });
    await settle();

    expect(call.getState()).toMatchObject({ screenShare: true, nativeScreenShare: true });

    // Backgrounding on iOS must NOT stop active native whole-phone sharing.
    setVisibility('hidden');
    await settle();
    expect(call.getState()).toMatchObject({
      screenShare: true,
      nativeScreenShare: true,
    });
    expect(call.getState().screenShareStoppedInBackground).toBeFalsy();
    expect(fakes.nativePlugin.stop).not.toHaveBeenCalled();

    // Returning to foreground immediately refreshes the native heartbeat lease.
    setVisibility('visible');
    await settle();
    expect(fakes.nativePlugin.heartbeat).toHaveBeenCalledWith({ generation: 1 });

    // setScreenShare(false) stops active native share and withdraws companion membership.
    await call.setScreenShare(false);
    await settle();
    expect(call.getState()).toMatchObject({ screenShare: false, nativeScreenShare: false });
    expect(fakes.nativePlugin.stop).toHaveBeenCalledTimes(1);
    expect(mx.sendStateEvent).toHaveBeenLastCalledWith(
      ROOM_ID,
      'org.matrix.msc3401.call.member',
      {},
      `_${ME}_${DEVICE}-screen_m.call`
    );

    // Starting again and calling leave() stops native share during teardown.
    await call.setNativeScreenShare(true);
    fakes.nativeScreenListener?.({ generation: 1, state: 'broadcasting' });
    await settle();
    expect(call.getState().nativeScreenShare).toBe(true);
    await call.leave();
    expect(fakes.nativePlugin.stop).toHaveBeenCalledTimes(2);
    expect(call.getState().nativeScreenShare).toBe(false);
  });

  it('surfaces typed native screen-share statuses and forwards picker sheet strings', async () => {
    vi.stubGlobal('navigator', IPHONE);
    fakes.nativeScreenShareAvailable = true;
    const { call } = setup({ encrypted: true });
    await call.join();
    const sheetStrings = {
      title: 'Share entire screen',
      body: 'Body',
      caption: 'Caption',
      cancel: 'Cancel',
    };

    // Connecting status appears on start, sheet strings reach plugin.start, and broadcasting clears it.
    await call.setNativeScreenShare(true, sheetStrings);
    expect(fakes.nativePlugin.start).toHaveBeenCalledWith(
      expect.objectContaining({ strings: sheetStrings })
    );
    expect(call.getState().nativeScreenShareStatus).toBe('connecting');
    fakes.nativeScreenListener?.({ generation: 1, state: 'broadcasting' });
    await settle();
    expect(call.getState().nativeScreenShare).toBe(true);
    expect(call.getState().nativeScreenShareStatus).toBeUndefined();

    // User stop, picker cancellation, and intentional system stop clear status without an error.
    await call.setNativeScreenShare(false);
    await settle();
    expect(call.getState().nativeScreenShareStatus).toBeUndefined();

    await call.setNativeScreenShare(true);
    expect(call.getState().nativeScreenShareStatus).toBe('connecting');
    fakes.nativeScreenListener?.({ generation: 1, state: 'stopped', reason: 'cancelled' });
    await settle();
    expect(call.getState().nativeScreenShare).toBe(false);
    expect(call.getState().nativeScreenShareStatus).toBeUndefined();

    await call.setNativeScreenShare(true);
    fakes.nativeScreenListener?.({ generation: 1, state: 'broadcasting' });
    await settle();
    expect(call.getState().nativeScreenShare).toBe(true);
    fakes.nativeScreenListener?.({ generation: 1, state: 'stopped', reason: 'system' });
    await settle();
    expect(call.getState().nativeScreenShare).toBe(false);
    expect(call.getState().nativeScreenShareStatus).toBeUndefined();

    // Start rejection, publish failure, and permissions failure map to 'failed' and can be dismissed.
    fakes.nativePlugin.start.mockRejectedValueOnce(new Error('TLS handshake failed'));
    await call.setNativeScreenShare(true);
    expect(call.getState().nativeScreenShareStatus).toBe('failed');
    call.dismissNativeScreenShareStatus();
    expect(call.getState().nativeScreenShareStatus).toBeUndefined();

    await call.setNativeScreenShare(true);
    fakes.nativeScreenListener?.({
      generation: 1,
      state: 'stopped',
      reason: 'publish_failed',
      detail: 'Broadcast socket closed',
    });
    await settle();
    expect(call.getState().nativeScreenShareStatus).toBe('failed');

    await call.setNativeScreenShare(true);
    fakes.nativeScreenListener?.({
      generation: 1,
      state: 'stopped',
      reason: 'permissions_failed',
    });
    await settle();
    expect(call.getState().nativeScreenShareStatus).toBe('failed');

    // Picker timeout maps to 'picker_timeout', and unexpected stops map to 'stopped'.
    await call.setNativeScreenShare(true);
    fakes.nativeScreenListener?.({ generation: 1, state: 'stopped', reason: 'picker_timeout' });
    await settle();
    expect(call.getState().nativeScreenShareStatus).toBe('picker_timeout');

    await call.setNativeScreenShare(true);
    fakes.nativeScreenListener?.({ generation: 1, state: 'broadcasting' });
    await settle();
    fakes.nativeScreenListener?.({
      generation: 1,
      state: 'stopped',
      reason: 'disconnected',
      detail: 'Network lost',
    });
    await settle();
    expect(call.getState().nativeScreenShareStatus).toBe('stopped');
  });

  it('withdraws a lingering companion state event on leave() even after native screen share already stopped offline', async () => {
    vi.stubGlobal('navigator', IPHONE);
    fakes.nativeScreenShareAvailable = true;
    const companionKey = `_${ME}_${DEVICE}-screen_m.call`;
    const { call, mx } = setup({
      encrypted: true,
      stateEvents: {
        [companionKey]: { application: 'm.call', device_id: `${DEVICE}-screen` },
      },
    });
    await call.join();

    await call.setNativeScreenShare(true);
    fakes.nativeScreenListener?.({ generation: 1, state: 'broadcasting' });
    await settle();

    // Native lease expires while offline so its own withdrawal fails, leaving room state stale.
    vi.mocked(mx.sendStateEvent).mockRejectedValueOnce(new Error('offline'));
    fakes.nativeScreenListener?.({ generation: 1, state: 'stopped', reason: 'lease_expired' });
    await settle();
    expect(call.getState()).toMatchObject({
      nativeScreenShare: false,
      nativeScreenShareStatus: 'stopped',
    });

    // Hanging up withdraws the lingering companion state event immediately.
    vi.mocked(mx.sendStateEvent).mockClear();
    await call.leave();
    expect(mx.sendStateEvent).toHaveBeenCalledWith(
      ROOM_ID,
      'org.matrix.msc3401.call.member',
      {},
      companionKey
    );

    // An already-empty companion state event does not trigger a redundant withdrawal.
    const empty = setup({ stateEvents: { [companionKey]: {} } });
    await empty.call.join();
    vi.mocked(empty.mx.sendStateEvent).mockClear();
    await empty.call.leave();
    expect(empty.mx.sendStateEvent).not.toHaveBeenCalled();
  });
});
