// @vitest-environment jsdom
import type { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CallMediaHost } from './callMedia';
import { WebCallMedia } from './webCallMedia';

type FakeRoom = EventEmitter & {
  state: string;
  connect: Mock;
  disconnect: Mock;
};

const fakes = vi.hoisted(() => ({
  rooms: [] as FakeRoom[],
  workers: [] as Array<{ terminate: Mock }>,
  browserSupported: true,
  keys: [] as Array<{ keyIndex: number; identity: string; key: Uint8Array }>,
}));

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
      getTrackPublication: vi.fn((_source: string): unknown => undefined),
      trackPublications: new Map<string, unknown>(),
      setMicrophoneEnabled: vi.fn(async () => undefined),
      setCameraEnabled: vi.fn(async () => undefined),
      setScreenShareEnabled: vi.fn(async () => undefined),
      setTrackSubscriptionPermissions: vi.fn(),
    };

    constructor(readonly options: unknown) {
      super();
      fakes.rooms.push(this);
    }

    setE2EEEnabled = vi.fn(async () => undefined);

    connect = vi.fn(async () => {
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

vi.mock('livekit-client/e2ee-worker?worker', () => ({
  default: class {
    terminate = vi.fn();

    constructor() {
      fakes.workers.push(this);
    }
  },
}));

vi.mock('./callKeyProvider', () => ({
  MatrixRtcKeyProvider: class {
    setParticipantKey = async (key: Uint8Array, keyIndex: number, identity: string) => {
      fakes.keys.push({ key, keyIndex, identity });
    };
  },
}));

const host = (members: string[] = []): CallMediaHost => ({
  isMember: (identity) => members.includes(identity),
  onChange: vi.fn(),
  onParticipantConnected: vi.fn(),
  onPhase: vi.fn(),
  onDisconnected: vi.fn(),
  onDevice: vi.fn(),
});

describe('WebCallMedia', () => {
  beforeEach(() => {
    fakes.rooms.length = 0;
    fakes.workers.length = 0;
    fakes.keys.length = 0;
    fakes.browserSupported = true;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('answers as no media does before it connects, and its setters do nothing', async () => {
    const media = new WebCallMedia({ encrypted: false, roomId: '!r:calls.test', host: host() });
    expect(media.connected()).toBe(false);
    expect(media.participant('@a:calls.test:A', false)).toBeUndefined();
    expect(media.audioBlocked()).toBe(false);
    expect(media.screenShare()).toBe(false);
    expect(media.microphoneTrack()).toBeUndefined();
    media.setMembers(new Set(['@a:calls.test:A']));
    media.setSound(false);
    media.silence();
    await expect(media.setDevice('audioinput', 'mic')).resolves.toBeUndefined();
    await expect(media.disconnect()).resolves.toBeUndefined();
    media.dispose();
    expect(fakes.rooms).toHaveLength(0);
  });

  it('answers false and connects nothing when the call stopped while encryption was turned on', async () => {
    const media = new WebCallMedia({ encrypted: true, roomId: '!r:calls.test', host: host() });
    const connected = await media.connect(
      { url: 'wss://sfu.calls.test', jwt: 'jwt' },
      { devices: {}, stopped: () => true }
    );
    expect(connected).toBe(false);
    expect(fakes.rooms[0]?.connect).not.toHaveBeenCalled();
  });

  it('a track attached while sound is off starts muted', async () => {
    const identity = '@a:calls.test:A';
    const media = new WebCallMedia({
      encrypted: false,
      roomId: '!r:calls.test',
      host: host([identity]),
    });
    await media.connect(
      { url: 'wss://sfu.calls.test', jwt: 'jwt' },
      { devices: {}, stopped: () => false }
    );
    media.setSound(false);
    const element = document.createElement('audio');
    const track = {
      kind: 'audio',
      attachedElements: [],
      attach: () => element,
      detach: () => [element],
    };
    fakes.rooms[0]?.emit('TrackSubscribed', track, {}, { identity });
    expect(element.muted).toBe(true);
    expect(document.querySelector('[data-call-audio="!r:calls.test"]')?.contains(element)).toBe(
      true
    );
  });
});
