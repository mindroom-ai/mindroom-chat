import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

const pluginSource = read('ios/App/App/MindRoomUpdatePlugin.swift');
const bridgeSource = read('ios/App/App/MindRoomBridgeViewController.swift');

describe('MindRoomUpdatePlugin native contract', () => {
  it('is the plugin nativeUpdate.ts asks, in the Developer ID Mac app only', () => {
    expect(
      pluginSource
        .trimStart()
        .startsWith('#if targetEnvironment(macCatalyst) && !MINDROOM_MAC_APP_STORE')
    ).toBe(true);
    expect(pluginSource).toContain('public let jsName = "MindRoomUpdate"');
    ['status', 'install'].forEach((method) => {
      expect(pluginSource).toContain(
        `CAPPluginMethod(name: "${method}", returnType: CAPPluginReturnPromise)`
      );
      expect(pluginSource).toContain(`@objc func ${method}(_ call: CAPPluginCall)`);
    });
    expect(pluginSource).toContain('call.reject("No update is ready", "NOT_READY")');
    // No events: Capacitor's listener table is not safe to notify from another queue.
    expect(pluginSource).not.toMatch(/notifyListeners|addListener/);
  });

  it('is registered on the main window only: the Quick Capture window shows no card', () => {
    expect(bridgeSource).toContain(
      'if !(self is QuickCaptureViewController) { bridge?.registerPluginInstance(MindRoomUpdatePlugin()) }'
    );
  });
});
