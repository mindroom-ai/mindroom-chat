// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { MatrixRTCSessionEvent } from 'matrix-js-sdk/lib/matrixrtc';
import { RoomCall, type RoomCallOptions } from './RoomCall';
import { getLivekitServiceUrl, requestSfuGrant } from './rtcFocus';
import { withdrawOwnMemberships } from './callResume';
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
}));

/** LiveKit keeps the publication and swaps the media track inside it on restart. */
const inputPublication = (
  source: string,
  mediaStreamTrack = { id: `${source}-default`, readyState: 'live' } as MediaStreamTrack
) => ({ source, isMuted: false, track: Object.assign(new EventEmitter(), { mediaStreamTrack }) });

vi.mock('livekit-client', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class FakeMediaRoom extends Emitter {
    state = 'disconnected';

    canPlaybackAudio = true;

    remoteParticipants = new Map();

    localParticipant = {
      isScreenShareEnabled: false,
      isSpeaking: false,
      isMicrophoneEnabled: false,
      getTrackPublication: vi.fn((source: string): unknown =>
        this.localParticipant.trackPublications.get(source)
      ),
      trackPublications: new Map<string, ReturnType<typeof inputPublication>>(),
      setMicrophoneEnabled: vi.fn(async (on: boolean) => this.toggleInput('microphone', on)),
      setCameraEnabled: vi.fn(async (on: boolean) => this.toggleInput('camera', on)),
      setScreenShareEnabled: vi.fn(async () => undefined),
      setTrackSubscriptionPermissions: vi.fn(),
    };

    private toggleInput(source: string, on: boolean) {
      const publications = this.localParticipant.trackPublications;
      const publication = publications.get(source) ?? (on ? inputPublication(source) : undefined);
      if (publication) {
        publication.isMuted = !on;
        publications.set(source, publication);
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

    switchActiveDevice = vi.fn(async () => true);

    startAudio = vi.fn(async () => undefined);
  }
  return {
    ConnectionState: { Connected: 'connected', Disconnected: 'disconnected' },
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
    setParticipantKey = async (key: Uint8Array, keyIndex: number, identity: string) => {
      fakes.keys.push({ key, keyIndex, identity });
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

const ME = '@me:calls.test';
const DEVICE = 'MYDEVICE';
const ROOM_ID = '!call:calls.test';

type FakeMembership = {
  userId: string;
  deviceId: string;
  transports: unknown[];
  isExpired: () => boolean;
  createdTs: () => number;
};

const membership = (userId: string, deviceId: string, createdTs = 1): FakeMembership => ({
  userId,
  deviceId,
  transports: [{ type: 'livekit', livekit_service_url: fakes.serviceUrl }],
  isExpired: () => false,
  createdTs: () => createdTs,
});

/** A MatrixRTC session of one room: its memberships, and whether this device joined it. */
class FakeSession extends EventEmitter {
  memberships: FakeMembership[] = [];

  joined = false;

  getOldestMembership = () => this.memberships[0];

  isJoined = () => this.joined;

  joinRTCSession = vi.fn((_identity: unknown, ..._rest: unknown[]) => {
    this.joined = true;
  });

  leaveRoomSession = vi.fn(async () => {
    this.joined = false;
    return true;
  });

  setMemberships(next: FakeMembership[]) {
    this.memberships = next;
    this.emit(MatrixRTCSessionEvent.MembershipsChanged, [], next);
  }
}

type FakeMediaRoom = EventEmitter & {
  state: string;
  options: { encryption?: unknown };
  connect: Mock;
  disconnect: Mock;
  setE2EEEnabled: Mock;
  remoteParticipants: Map<string, unknown>;
  localParticipant: {
    getTrackPublication: Mock;
    trackPublications: Map<string, unknown>;
    setMicrophoneEnabled: Mock;
    setCameraEnabled: Mock;
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
}: {
  encrypted?: boolean;
  grant?: RoomCallOptions['grant'];
  video?: boolean;
  microphone?: boolean;
} = {}) => {
  const session = new FakeSession();
  const mx = {
    matrixRTC: { getRoomSession: () => session },
    getSafeUserId: () => ME,
    getUserId: () => ME,
    getDeviceId: () => DEVICE,
    getOpenIdToken: vi.fn(async () => ({
      access_token: 'openid',
      token_type: 'Bearer',
      matrix_server_name: 'calls.test',
      expires_in: 3600,
    })),
  } as unknown as MatrixClient;
  const room = {
    roomId: ROOM_ID,
    hasEncryptionStateEvent: () => encrypted,
  } as unknown as Room;
  // The device lock `startCall` took before making the call.
  const releaseDeviceLock = vi.fn();
  fakes.releases.push(releaseDeviceLock);
  const call = new RoomCall({ mx, room, releaseDeviceLock, grant, video, microphone });
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
  vi.mocked(getLivekitServiceUrl).mockClear();
  vi.mocked(requestSfuGrant).mockClear();
  vi.mocked(withdrawOwnMemberships).mockClear();
  vi.mocked(sendCallKey).mockReset();
  vi.mocked(sendCallKey).mockResolvedValue(undefined);
});

afterEach(() => {
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
    expect(session.joinRTCSession).not.toHaveBeenCalled();
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
    expect(session.joinRTCSession).not.toHaveBeenCalled();
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
    expect(session.joinRTCSession).not.toHaveBeenCalled();
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
    await vi.waitFor(() => expect(session.joinRTCSession).toHaveBeenCalledTimes(1));
    // The others hear of the call while the media still connects.
    const media = onlyMediaRoom();
    expect(media.connect).toHaveBeenCalledWith('wss://sfu.calls.test', 'jwt');
    expect(call.getState().phase).toBe('connecting');
    expect(media.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    connected.resolve();
    await joining;

    expect(session.joinRTCSession).toHaveBeenCalledWith(
      { userId: ME, deviceId: DEVICE, memberId: `${ME}:${DEVICE}` },
      [{ type: 'livekit', livekit_service_url: fakes.serviceUrl, livekit_alias: ROOM_ID }],
      undefined,
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
    expect(session.joinRTCSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      expect.objectContaining({ manageMediaKeys: true })
    );
  });

  it('fails for a browser without WebRTC, and lets the device lock go', async () => {
    fakes.browserSupported = false;
    const { call, session } = setup();

    await call.join();

    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'browser' });
    expect(session.joinRTCSession).not.toHaveBeenCalled();
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
    const { call } = setup();

    await call.join();

    expect(call.getState()).toMatchObject({
      phase: 'connected',
      problem: 'device',
      microphone: false,
    });

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

  it('treats an ended publication returned by an enable as a capture failure', async () => {
    const { call } = setup({ microphone: false });
    await call.join();
    const { localParticipant } = onlyMediaRoom();
    const ended = inputPublication('microphone', { readyState: 'ended' } as MediaStreamTrack);
    localParticipant.setMicrophoneEnabled.mockImplementationOnce(async () => {
      localParticipant.trackPublications.set('microphone', ended);
      return ended;
    });

    await call.setMicrophone(true);
    expect(call.getState()).toMatchObject({ microphone: false, problem: 'device' });
  });

  it('clears a camera capture warning when the same LiveKit track restarts', async () => {
    const { call } = setup();
    await call.join();
    const media = onlyMediaRoom();
    const publication = inputPublication('camera', { readyState: 'ended' } as MediaStreamTrack);
    media.localParticipant.trackPublications.set('camera', publication);
    media.emit('LocalTrackPublished', publication);
    await call.setCamera(true);
    expect(call.getState().problem).toBe('device');

    publication.track.mediaStreamTrack = { readyState: 'live' } as MediaStreamTrack;
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
    expect(call.getState()).toMatchObject({ phase: 'connected', microphoneTrack: MIC_A });
    expect(call.getState().problem).toBeUndefined();
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

  it('shows the microphone as on if muting rejects and it is still live', async () => {
    const { call } = setup();
    await call.join();
    onlyMediaRoom().localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(
      new Error('Mute failed')
    );

    await call.setMicrophone(false);
    expect(call.getState().microphone).toBe(true);
    expect(call.getState().problem).toBeUndefined();
  });

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

  it('does not update the call when a pending retry rejects after disconnect', async () => {
    const { call } = setup();
    await call.join();
    const media = onlyMediaRoom();
    media.localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(
      new Error('NotReadableError')
    );
    await call.setMicrophone(true);

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
    expect(session.leaveRoomSession).toHaveBeenCalledTimes(1);
    expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
  });

  it('withdraws the membership when the media dropped although its connect went through', async () => {
    fakes.connect = async (room) => {
      (room as FakeMediaRoom).emit('Disconnected');
    };
    const { call, session } = setup();

    await call.join();

    expect(session.leaveRoomSession).toHaveBeenCalledTimes(1);
    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'connection' });
    expect(onlyMediaRoom().disconnect).toHaveBeenCalled();
  });

  it('fails with the service problem, and opens no media connection, when the membership cannot be made', async () => {
    const { call, session } = setup({ encrypted: true });
    session.joinRTCSession.mockImplementationOnce(() => {
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
    expect(session.leaveRoomSession).toHaveBeenCalledTimes(1);
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
    expect(session.leaveRoomSession).toHaveBeenCalledTimes(1);
    expect(fakes.releases[0]).toHaveBeenCalledTimes(1);
  });

  it('fails with the connection problem when its membership cannot be kept', async () => {
    const { call, session } = setup();
    await call.join();

    session.emit(MatrixRTCSessionEvent.MembershipManagerError, new Error('state event refused'));
    await settle();

    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'connection' });
    expect(session.leaveRoomSession).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed call failed when it is left, and lets go of everything once', async () => {
    const { call, session } = setup({ encrypted: true });
    await call.join();
    const media = onlyMediaRoom();

    media.emit('Disconnected');
    await call.leave();

    expect(call.getState()).toMatchObject({ phase: 'failed', problem: 'connection' });
    expect(media.disconnect).toHaveBeenCalledTimes(1);
    expect(session.leaveRoomSession).toHaveBeenCalledTimes(1);
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

const MIC_A = { id: 'mic-a', readyState: 'live' } as MediaStreamTrack;
const MIC_B = { id: 'mic-b', readyState: 'live' } as MediaStreamTrack;
const MIC_C = { id: 'mic-c', readyState: 'live' } as MediaStreamTrack;

describe('RoomCall microphone track', () => {
  it('shows the microphone it publishes, none while muted, and tells its subscribers of each change', async () => {
    const { call } = setup({ microphone: false });
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
    expect(session.joinRTCSession).not.toHaveBeenCalled();
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
const joinedAs = (session: FakeSession) =>
  defined(session.joinRTCSession.mock.calls[0], 'a join')[0];

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
    await vi.waitFor(() => expect(session.joinRTCSession).toHaveBeenCalled());
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
