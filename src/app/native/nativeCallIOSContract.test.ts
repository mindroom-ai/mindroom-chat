import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import capacitorConfig from '../../../capacitor.config';

const urlOf = (path: string) => new URL(`../../../${path}`, import.meta.url);
const read = (path: string) => readFileSync(urlOf(path), 'utf8');
const readOptional = (path: string) => (existsSync(urlOf(path)) ? read(path) : '');

const projectSource = read('ios/App/App.xcodeproj/project.pbxproj');
const bridgeSource = read('ios/App/App/MindRoomBridgeViewController.swift');
const sceneSource = read('ios/App/App/SceneDelegate.swift');
const wrapperSource = read('src/app/native/nativeCall.ts');

describe('LiveKit Swift package', () => {
  it('is pinned to exactly 2.19.0', () => {
    expect(projectSource).toMatch(
      /isa = XCRemoteSwiftPackageReference;\s*repositoryURL = "https:\/\/github\.com\/livekit\/client-sdk-swift";\s*requirement = \{\s*kind = exactVersion;\s*version = 2\.19\.0;\s*\};/
    );
    const resolved = JSON.parse(
      read('ios/App/App.xcworkspace/xcshareddata/swiftpm/Package.resolved')
    ) as { pins: Array<{ identity: string; state: { version?: string } }> };
    const version = (identity: string) =>
      resolved.pins.find((pin) => pin.identity === identity)?.state.version;
    expect(version('client-sdk-swift')).toBe('2.19.0');
    expect(version('webrtc-xcframework')).toBe('150.7871.4');
    expect(version('livekit-ffi-xcframework')).toBe('0.13.1');
  });

  it('is linked by both Mac targets, for Mac Catalyst only', () => {
    const links = projectSource.match(
      /\/\* LiveKit in Frameworks \*\/ = \{isa = PBXBuildFile; platformFilter = maccatalyst; productRef = [0-9A-F]{24} \/\* LiveKit \*\/; \};/g
    );
    expect(links).toHaveLength(2);
    expect(projectSource.match(/productName = LiveKit;/g)).toHaveLength(2);
  });
});

describe('MindRoomCallPlugin native contract', () => {
  const pluginSource = readOptional('ios/App/App/MindRoomCallPlugin.swift');
  it('is the plugin the web side registers, with its methods', () => {
    expect(pluginSource).toContain('public let jsName = "MindRoomCall"');
    expect(wrapperSource).toContain("('MindRoomCall')");
    [
      'connect',
      'setKey',
      'setMembers',
      'setSound',
      'setMicrophone',
      'snapshot',
      'disconnect',
    ].forEach((method) => {
      expect(pluginSource).toContain(
        `CAPPluginMethod(name: "${method}", returnType: CAPPluginReturnPromise)`
      );
      expect(pluginSource).toContain(`@objc func ${method}(_ call: CAPPluginCall)`);
    });
  });

  it('is compiled for Mac Catalyst only, in both Mac targets', () => {
    expect(pluginSource.trimStart().startsWith('#if targetEnvironment(macCatalyst)')).toBe(true);
    expect(pluginSource.trimEnd().endsWith('#endif')).toBe(true);
    const ifIndex = pluginSource.indexOf('#if targetEnvironment(macCatalyst)');
    const importIndex = pluginSource.indexOf('import LiveKit');
    expect(importIndex).toBeGreaterThan(ifIndex);
    expect(projectSource.match(/MindRoomCallPlugin\.swift in Sources \*\/,/g)).toHaveLength(2);
  });

  it('is registered on the main window only, inside the Catalyst block, and closes with its window', () => {
    expect(bridgeSource).toMatch(
      /#if targetEnvironment\(macCatalyst\)[\s\S]*?if !\(self is QuickCaptureViewController\) \{[\s\S]*?registerPluginInstance\(MindRoomCallPlugin\(\)\)[\s\S]*?\}\s*#endif/
    );
    expect(sceneSource).toMatch(
      /plugin\(withName: "MindRoomCall"\) as\? MindRoomCallPlugin\)\?\.close\(\)[\s\S]*?QuickCapture\.stopPage\(of: window\)/
    );
  });

  it('disables Capacitor iOS/Mac bridge logging so tokens and call keys are never logged in Debug builds', () => {
    expect(capacitorConfig.ios?.loggingBehavior).toBe('none');
  });
});
