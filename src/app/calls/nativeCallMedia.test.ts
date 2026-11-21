// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindRoomCallPlugin, NativeCallSnapshot } from '../native/nativeCall';
import type { CallMediaHost } from './callMedia';
import { NATIVE_CALL_POLL_MS, NativeCallMedia } from './nativeCallMedia';

const defaultSnapshot = (): NativeCallSnapshot => ({
  state: 'connected',
  local: { speaking: false, microphone: false },
  participants: [],
});

const makePlugin = () => ({
  connect: vi.fn<MindRoomCallPlugin['connect']>(async () => ({ id: 's1' })),
  setKey: vi.fn<MindRoomCallPlugin['setKey']>(async () => undefined),
  setMembers: vi.fn<MindRoomCallPlugin['setMembers']>(async () => undefined),
  setSound: vi.fn<MindRoomCallPlugin['setSound']>(async () => undefined),
  setMicrophone: vi.fn<MindRoomCallPlugin['setMicrophone']>(async () => undefined),
  snapshot: vi.fn<MindRoomCallPlugin['snapshot']>(async () => defaultSnapshot()),
  disconnect: vi.fn<MindRoomCallPlugin['disconnect']>(async () => undefined),
});

const makeHost = (): CallMediaHost => ({
  isMember: vi.fn(() => true),
  onChange: vi.fn(),
  onParticipantConnected: vi.fn(),
  onPhase: vi.fn(),
  onDisconnected: vi.fn(),
  onDevice: vi.fn(),
});

const grant = { url: 'wss://sfu.calls.test', jwt: 'jwt' };
const go = { devices: {}, stopped: () => false };

describe('NativeCallMedia', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete (globalThis as Record<string, unknown>).mindroomCallStart;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).mindroomCallStart;
  });

  it('names its start on the page and connects with the grant', async () => {
    const plugin = makePlugin();
    const media = new NativeCallMedia({
      encrypted: true,
      host: makeHost(),
      plugin,
    });

    await expect(media.connect(grant, go)).resolves.toBe(true);
    const callArg = plugin.connect.mock.calls[0]?.[0];
    expect(callArg).toBeDefined();
    expect(typeof callArg?.nonce).toBe('string');
    expect(callArg?.nonce).toBe((globalThis as Record<string, unknown>).mindroomCallStart);
    expect(callArg).toEqual({
      nonce: callArg?.nonce,
      url: 'wss://sfu.calls.test',
      token: 'jwt',
      encrypted: true,
    });
    expect(media.connected()).toBe(true);
    media.silence();
  });

  it('connects nothing when the call already stopped', async () => {
    const plugin = makePlugin();
    const media = new NativeCallMedia({
      encrypted: true,
      host: makeHost(),
      plugin,
    });

    await expect(media.connect(grant, { devices: {}, stopped: () => true })).resolves.toBe(false);
    expect(plugin.connect).not.toHaveBeenCalled();
  });

  it('keeps keys, members and sound until the session has an id, then sends them in order', async () => {
    const plugin = makePlugin();
    const media = new NativeCallMedia({
      encrypted: true,
      host: makeHost(),
      plugin,
    });

    await media.setKey(new Uint8Array([1, 2, 3]), 4, '@a:calls.test:A', false);
    media.setMembers(new Set(['@a:calls.test:A']));
    media.setSound(false);
    expect(plugin.setKey).not.toHaveBeenCalled();
    expect(plugin.setMembers).not.toHaveBeenCalled();
    expect(plugin.setSound).not.toHaveBeenCalled();

    await media.connect(grant, go);
    expect(plugin.setKey).toHaveBeenCalledWith({
      id: 's1',
      identity: '@a:calls.test:A',
      index: 4,
      key: 'AQID',
      own: false,
    });
    expect(plugin.setMembers).toHaveBeenCalledWith({ id: 's1', identities: ['@a:calls.test:A'] });
    expect(plugin.setSound).toHaveBeenCalledWith({ id: 's1', on: false });

    const keyOrder = plugin.setKey.mock.invocationCallOrder[0] ?? 0;
    const membersOrder = plugin.setMembers.mock.invocationCallOrder[0] ?? 0;
    const soundOrder = plugin.setSound.mock.invocationCallOrder[0] ?? 0;
    expect(keyOrder).toBeLessThan(membersOrder);
    expect(membersOrder).toBeLessThan(soundOrder);
    media.silence();
  });

  it("passes own for this device's key", async () => {
    const plugin = makePlugin();
    const media = new NativeCallMedia({
      encrypted: true,
      host: makeHost(),
      plugin,
    });

    await media.connect(grant, go);
    await media.setKey(new Uint8Array([7, 8]), 0, '@me:calls.test:ME', true);
    expect(plugin.setKey).toHaveBeenCalledWith({
      id: 's1',
      identity: '@me:calls.test:ME',
      index: 0,
      key: 'Bwg=',
      own: true,
    });
    media.silence();
  });

  it('reports a new participant, changes and phases from snapshots', async () => {
    const plugin = makePlugin();
    const host = makeHost();
    const media = new NativeCallMedia({
      encrypted: false,
      host,
      plugin,
    });
    const A = '@a:calls.test:A';
    const snapshots: NativeCallSnapshot[] = [
      {
        state: 'connected',
        local: { speaking: false, microphone: false },
        participants: [{ identity: A, speaking: false, microphone: true }],
      },
      {
        state: 'connected',
        local: { speaking: false, microphone: false },
        participants: [{ identity: A, speaking: false, microphone: true }],
      },
      {
        state: 'reconnecting',
        local: { speaking: false, microphone: false },
        participants: [{ identity: A, speaking: false, microphone: true }],
      },
      {
        state: 'connected',
        local: { speaking: false, microphone: false },
        participants: [{ identity: A, speaking: false, microphone: true }],
      },
      {
        state: 'connected',
        local: { speaking: true, microphone: false },
        participants: [{ identity: A, speaking: false, microphone: true }],
      },
    ];
    let step = 0;
    plugin.snapshot.mockImplementation(async () => snapshots[step++] ?? defaultSnapshot());

    await media.connect(grant, go);

    // (1) new participant A
    await vi.advanceTimersByTimeAsync(NATIVE_CALL_POLL_MS);
    expect(host.onParticipantConnected).toHaveBeenCalledTimes(1);
    expect(host.onParticipantConnected).toHaveBeenCalledWith(A);
    expect(host.onChange).toHaveBeenCalledTimes(1);
    expect(media.participant(A, false)).toEqual({ speaking: false, microphone: true });

    // (2) identical snapshot: no further host calls
    vi.mocked(host.onChange).mockClear();
    vi.mocked(host.onParticipantConnected).mockClear();
    await vi.advanceTimersByTimeAsync(NATIVE_CALL_POLL_MS);
    expect(host.onParticipantConnected).not.toHaveBeenCalled();
    expect(host.onChange).not.toHaveBeenCalled();
    expect(host.onPhase).not.toHaveBeenCalled();

    // (3) reconnecting
    await vi.advanceTimersByTimeAsync(NATIVE_CALL_POLL_MS);
    expect(host.onPhase).toHaveBeenLastCalledWith('reconnecting');
    expect(media.connected()).toBe(false);

    // (4) connected again
    await vi.advanceTimersByTimeAsync(NATIVE_CALL_POLL_MS);
    expect(host.onPhase).toHaveBeenLastCalledWith('connected');
    expect(media.connected()).toBe(true);

    // (5) local speaking
    await vi.advanceTimersByTimeAsync(NATIVE_CALL_POLL_MS);
    expect(media.participant('@me:calls.test:ME', true)).toEqual({
      speaking: true,
      microphone: false,
    });
    media.silence();
  });

  it('a lost session disconnects once', async () => {
    const plugin1 = makePlugin();
    const host1 = makeHost();
    plugin1.snapshot.mockRejectedValue({ code: 'NOT_CONNECTED' });
    const media1 = new NativeCallMedia({
      encrypted: false,
      host: host1,
      plugin: plugin1,
    });
    await media1.connect(grant, go);
    await vi.advanceTimersByTimeAsync(NATIVE_CALL_POLL_MS);
    expect(host1.onDisconnected).toHaveBeenCalledTimes(1);
    const callsAfterLoss = plugin1.snapshot.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(plugin1.snapshot).toHaveBeenCalledTimes(callsAfterLoss);

    const plugin2 = makePlugin();
    const host2 = makeHost();
    plugin2.snapshot.mockResolvedValue({
      state: 'disconnected',
      local: { speaking: false, microphone: false },
      participants: [],
    });
    const media2 = new NativeCallMedia({
      encrypted: false,
      host: host2,
      plugin: plugin2,
    });
    await media2.connect(grant, go);
    await vi.advanceTimersByTimeAsync(NATIVE_CALL_POLL_MS);
    expect(host2.onDisconnected).toHaveBeenCalledTimes(1);
    const callsAfterDisc = plugin2.snapshot.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(plugin2.snapshot).toHaveBeenCalledTimes(callsAfterDisc);
  });

  it('ignores a snapshot that fails otherwise', async () => {
    const plugin = makePlugin();
    const host = makeHost();
    plugin.snapshot.mockRejectedValueOnce(new Error('busy')).mockResolvedValue(defaultSnapshot());
    const media = new NativeCallMedia({
      encrypted: false,
      host,
      plugin,
    });
    await media.connect(grant, go);
    await vi.advanceTimersByTimeAsync(NATIVE_CALL_POLL_MS);
    expect(host.onDisconnected).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(NATIVE_CALL_POLL_MS);
    expect(plugin.snapshot).toHaveBeenCalledTimes(2);
    expect(host.onDisconnected).not.toHaveBeenCalled();
    media.silence();
  });

  it('asks for one snapshot at a time', async () => {
    const plugin = makePlugin();
    plugin.snapshot.mockImplementation(() => new Promise<NativeCallSnapshot>(() => undefined));
    const media = new NativeCallMedia({
      encrypted: false,
      host: makeHost(),
      plugin,
    });
    await media.connect(grant, go);
    await vi.advanceTimersByTimeAsync(1000);
    expect(plugin.snapshot).toHaveBeenCalledTimes(1);
    media.silence();
  });

  it('a microphone the Mac refuses rejects with its code', async () => {
    const plugin = makePlugin();
    plugin.setMicrophone.mockRejectedValue({ code: 'PERMISSION_DENIED' });
    const media = new NativeCallMedia({
      encrypted: false,
      host: makeHost(),
      plugin,
    });
    await expect(media.setMicrophone(true)).resolves.toBeUndefined();
    expect(plugin.setMicrophone).not.toHaveBeenCalled();

    await media.connect(grant, go);
    await expect(media.setMicrophone(true)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    media.silence();
  });

  it('has no camera, screen share, devices or microphone track', async () => {
    const plugin = makePlugin();
    const media = new NativeCallMedia({
      encrypted: false,
      host: makeHost(),
      plugin,
    });
    await media.connect(grant, go);
    await expect(media.setCamera(true)).rejects.toBeDefined();
    await expect(media.setCamera(false)).resolves.toBeUndefined();
    await expect(media.setScreenShare(true)).resolves.toBeUndefined();
    await expect(media.setDevice('audioinput', 'x')).resolves.toBeUndefined();
    await expect(media.resumeAudio()).resolves.toBeUndefined();
    expect(media.screenShare()).toBe(false);
    expect(media.audioBlocked()).toBe(false);
    expect(media.microphoneTrack()).toBeUndefined();
    media.silence();
  });

  it('silence stops the polling', async () => {
    const plugin = makePlugin();
    const media = new NativeCallMedia({
      encrypted: false,
      host: makeHost(),
      plugin,
    });
    await media.connect(grant, go);
    media.silence();
    await vi.advanceTimersByTimeAsync(1000);
    expect(plugin.snapshot).not.toHaveBeenCalled();
  });

  it('a connect that answers after silence starts no polling, and the next disconnect ends the session', async () => {
    const plugin = makePlugin();
    let resolveConnect!: (value: { id: string }) => void;
    plugin.connect.mockImplementation(
      () =>
        new Promise<{ id: string }>((resolve) => {
          resolveConnect = resolve;
        })
    );
    const media = new NativeCallMedia({
      encrypted: false,
      host: makeHost(),
      plugin,
    });

    const connecting = media.connect(grant, go);
    media.silence();
    await media.disconnect();
    expect(plugin.disconnect).not.toHaveBeenCalled();

    resolveConnect({ id: 's1' });
    await expect(connecting).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(plugin.snapshot).not.toHaveBeenCalled();

    await media.disconnect();
    expect(plugin.disconnect).toHaveBeenCalledWith({ id: 's1' });
  });

  it('rejects key indices outside 0..255 before reaching the plugin', async () => {
    const plugin = makePlugin();
    const media = new NativeCallMedia({
      encrypted: true,
      host: makeHost(),
      plugin,
    });
    await media.connect(grant, go);

    for (const bad of [-1, 256, 2_147_483_648, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        media.setKey(new Uint8Array([1]), bad, '@a:calls.test:A', false)
      ).rejects.toMatchObject({
        code: 'BAD_KEY',
      });
    }
    expect(plugin.setKey).not.toHaveBeenCalled();

    await expect(
      media.setKey(new Uint8Array([1]), 0, '@a:calls.test:A', false)
    ).resolves.toBeUndefined();
    await expect(
      media.setKey(new Uint8Array([2]), 255, '@a:calls.test:A', true)
    ).resolves.toBeUndefined();
    expect(plugin.setKey).toHaveBeenCalledTimes(2);
    media.silence();
  });

  it('coalesces queued members and sound to the latest value while keeping keys in order', async () => {
    const plugin = makePlugin();
    const media = new NativeCallMedia({
      encrypted: true,
      host: makeHost(),
      plugin,
    });

    await media.setKey(new Uint8Array([1]), 0, '@a:calls.test:A', false);
    media.setMembers(new Set(['@a:calls.test:A']));
    media.setSound(false);
    await media.setKey(new Uint8Array([2]), 1, '@a:calls.test:A', false);
    media.setMembers(new Set(['@b:calls.test:B']));
    media.setSound(true);

    await media.connect(grant, go);

    expect(plugin.setKey).toHaveBeenCalledTimes(2);
    expect(plugin.setKey.mock.calls[0]?.[0]).toMatchObject({ index: 0, key: 'AQ==' });
    expect(plugin.setKey.mock.calls[1]?.[0]).toMatchObject({ index: 1, key: 'Ag==' });
    expect(plugin.setMembers).toHaveBeenCalledTimes(1);
    expect(plugin.setMembers).toHaveBeenCalledWith({ id: 's1', identities: ['@b:calls.test:B'] });
    expect(plugin.setSound).toHaveBeenCalledTimes(1);
    expect(plugin.setSound).toHaveBeenCalledWith({ id: 's1', on: true });
    media.silence();
  });
});
