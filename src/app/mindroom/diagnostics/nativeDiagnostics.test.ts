import { Capacitor, registerPlugin } from '@capacitor/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nativePlugin = vi.hoisted(() => ({
  read: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => 'web'),
    isNativePlatform: vi.fn(() => false),
    isPluginAvailable: vi.fn(() => false),
  },
  registerPlugin: vi.fn(() => nativePlugin),
}));

const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const readDiagnostics = async () => {
  const diagnostics = await import('./nativeDiagnostics');
  return diagnostics.readNativeDiagnostics();
};

describe('native diagnostics reader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
  });

  it('reports unsupported without registering or invoking a plugin on web', async () => {
    await expect(readDiagnostics()).resolves.toEqual({
      schemaVersion: 1,
      status: 'unsupported',
      currentSessionId: null,
      events: [],
      droppedEventCount: 0,
    });

    expect(registerPlugin).not.toHaveBeenCalled();
    expect(nativePlugin.read).not.toHaveBeenCalled();
  });

  it('reports unsupported on an old native build without the plugin', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

    await expect(readDiagnostics()).resolves.toMatchObject({ status: 'unsupported', events: [] });

    expect(registerPlugin).not.toHaveBeenCalled();
    expect(nativePlugin.read).not.toHaveBeenCalled();
  });

  it('sanitizes a valid native snapshot at the JavaScript boundary', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    nativePlugin.read.mockResolvedValue({
      schemaVersion: 1,
      status: 'available',
      currentSessionId: sessionId,
      events: [
        {
          at: 100,
          monotonicMs: 12.5,
          sequence: 2,
          sessionId,
          name: 'navigation.failed',
          url: 'https://secret.example/room/abc',
          data: {
            loading: false,
            progress: 0.5,
            errorDomain: 'webkit',
            errorCode: 102,
            description: 'secret query=token',
          },
        },
      ],
      droppedEventCount: 3,
      storagePath: '/private/secret',
    });

    await expect(readDiagnostics()).resolves.toEqual({
      schemaVersion: 1,
      status: 'available',
      currentSessionId: sessionId,
      events: [
        {
          at: 100,
          monotonicMs: 12.5,
          sequence: 2,
          sessionId,
          name: 'navigation.failed',
          data: {
            loading: false,
            progress: 0.5,
            errorDomain: 'webkit',
            errorCode: 102,
          },
        },
      ],
      droppedEventCount: 3,
    });
  });

  it('reports invalid for malformed native output', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    nativePlugin.read.mockResolvedValue({
      schemaVersion: 1,
      status: 'available',
      currentSessionId: 'not-a-uuid',
      events: [],
      droppedEventCount: 0,
    });

    await expect(readDiagnostics()).resolves.toMatchObject({
      status: 'invalid',
      currentSessionId: null,
      events: [],
    });
  });

  it('reports unavailable when the native call rejects', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    nativePlugin.read.mockRejectedValue(new Error('native secret'));

    await expect(readDiagnostics()).resolves.toMatchObject({
      status: 'unavailable',
      currentSessionId: null,
      events: [],
    });
  });

  it('keeps the newest 128 safe events and accounts for JavaScript-side drops', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    nativePlugin.read.mockResolvedValue({
      schemaVersion: 1,
      status: 'corrupt',
      currentSessionId: sessionId,
      events: Array.from({ length: 130 }, (_, index) => ({
        at: index,
        monotonicMs: index,
        sequence: index,
        sessionId,
        name: 'scene.active',
      })),
      droppedEventCount: 1,
    });

    const snapshot = await readDiagnostics();

    expect(snapshot.status).toBe('corrupt');
    expect(snapshot.events).toHaveLength(128);
    expect(snapshot.events[0]?.sequence).toBe(2);
    expect(snapshot.events[127]?.sequence).toBe(129);
    expect(snapshot.droppedEventCount).toBe(3);
  });
});
