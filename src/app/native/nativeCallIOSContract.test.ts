import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const urlOf = (path: string) => new URL(`../../../${path}`, import.meta.url);
const read = (path: string) => readFileSync(urlOf(path), 'utf8');
const readOptional = (path: string) => (existsSync(urlOf(path)) ? read(path) : '');

const projectSource = read('ios/App/App.xcodeproj/project.pbxproj');
const bridgeSource = read('ios/App/App/MindRoomBridgeViewController.swift');
const sceneSource = read('ios/App/App/SceneDelegate.swift');
const recorderSource = read('ios/App/App/MindRoomVoiceRecorderPlugin.swift');
const wrapperSource = read('src/app/native/nativeCall.ts');
const mediaSource = read('src/app/calls/nativeCallMedia.ts');

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
  /** The body of one plugin method, so that a check of one method cannot be met by another. */
  const body = (method: string) =>
    pluginSource.match(
      new RegExp(`@objc func ${method}\\(_ call: CAPPluginCall\\) \\{\n[\\s\\S]*?\n {4}\\}\n`)
    )?.[0] ?? '';

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

  it('is registered on the main window only, inside the Catalyst block', () => {
    expect(bridgeSource).toMatch(
      /#if targetEnvironment\(macCatalyst\)[\s\S]*?if !\(self is QuickCaptureViewController\) \{[\s\S]*?registerPluginInstance\(MindRoomCallPlugin\(\)\)[\s\S]*?\}\s*#endif/
    );
  });

  it('keys frames as the web client and the agent do', () => {
    expect(pluginSource).toMatch(
      /KeyProviderOptions\([\s\S]*?sharedKey: false,[\s\S]*?ratchetWindowSize: 10,[\s\S]*?failureTolerance: 10,[\s\S]*?keyRingSize: 256,[\s\S]*?keyDerivationAlgorithm: \.hkdf/
    );
    expect(pluginSource).toContain('EncryptionOptions(keyProvider:');
    expect(pluginSource).toContain('ConnectOptions(autoSubscribe: false)');
  });

  it('moves the sending index only for the own key', () => {
    expect(body('setKey')).toMatch(
      /setKey\(keyData: key, participantId: identity, index: Int32\(index\)\)\s*if call\.getBool\("own"\) == true \{\s*session\.keyProvider\?\.setCurrentKeyIndex\(Int32\(index\)\)/
    );
    expect(pluginSource.match(/setCurrentKeyIndex/g)).toHaveLength(1);
  });

  it('connects only for the newest start of the page that is still loaded', () => {
    expect(mediaSource).toMatch(
      /Object\.assign\(globalThis, \{ mindroomCallStart: nonce \}\);[\s\S]*?\.connect\(\{\s*nonce,/
    );
    const connectBody = body('connect');
    const splitPoint = connectBody.indexOf('evaluateJavaScript("window.mindroomCallStart")');
    expect(splitPoint).toBeGreaterThan(-1);
    const before = connectBody.slice(0, splitPoint);
    const after = connectBody.slice(splitPoint);
    expect(before).toContain('!self.closed');
    expect(before).toContain('!webView.isLoading');
    expect(before).toContain('let generation = self.generation');
    expect(before).not.toContain('Room(');
    expect(after).toMatch(
      /guard generation == self\.generation, !self\.closed, !webView\.isLoading,\s*\(newest as\? String\) == nonce else \{[\s\S]*?self\.endLive\(\)[\s\S]*?Room\(/
    );
  });

  it('gives up a connect that a page load, a closed window or a newer start overtook', () => {
    const connectBody = body('connect');
    const afterRoomConnect = connectBody.split('try await room.connect(url: url, token: token)')[1];
    expect(afterRoomConnect).toMatch(
      /guard self\.live === session else \{\s*return call\.reject\("The page is gone", "START_FAILED"\)/
    );
  });

  it('opens the microphone only for the session that asked, after the prompt', () => {
    expect(body('setMicrophone')).toMatch(
      /AVCaptureDevice\.requestAccess\(for: \.audio\)[\s\S]*?guard self\.live === session else \{\s*return call\.reject\("No such call", "NOT_CONNECTED"\)[\s\S]*?"PERMISSION_DENIED"[\s\S]*?"NO_MICROPHONE"/
    );
    expect(pluginSource.match(/setMicrophone\(enabled: on\)/g)).toHaveLength(1);
  });

  it('ends the session on every way out', () => {
    expect(pluginSource.match(/room\.disconnect\(\)/g)).toHaveLength(1);
    const endLiveBody =
      pluginSource.match(/private func endLive\(\) \{\n[\s\S]*?\n {4}\}\n/)?.[0] ?? '';
    expect(endLiveBody).toContain('room.disconnect()');
    expect(body('disconnect')).toContain('endLive()');
    const pageWillLoadBody =
      pluginSource.match(/@objc private func pageWillLoad\(\) \{\n[\s\S]*?\n {4}\}\n/)?.[0] ?? '';
    expect(pageWillLoadBody).toContain('endLive()');
    const connectBody = body('connect');
    expect(connectBody.match(/endLive\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(pluginSource).toMatch(/func close\(\) \{\s*closed = true\s*pageWillLoad\(\)\s*\}/);
    const loadBody =
      pluginSource.match(/override public func load\(\) \{\n[\s\S]*?\n {4}\}\n/)?.[0] ?? '';
    expect(loadBody).toContain('.capacitorWebViewNavigationStarted');
    expect(loadBody).toContain('.capacitorWebViewTerminated');
    expect(sceneSource).toMatch(
      /plugin\(withName: "MindRoomCall"\) as\? MindRoomCallPlugin\)\?\.close\(\)[\s\S]*?QuickCapture\.stopPage\(of: window\)/
    );
  });

  it('applies members again when the room changes', () => {
    expect(pluginSource).toMatch(/participantDidConnect[\s\S]*?roomChanged\(room\)/);
    expect(pluginSource).toMatch(
      /didPublishTrack publication: RemoteTrackPublication[\s\S]*?roomChanged\(room\)/
    );
    expect(pluginSource).toMatch(/didSubscribeTrack[\s\S]*?roomChanged\(room\)/);
    expect(pluginSource).toMatch(/roomDidReconnect[\s\S]*?roomChanged\(room\)/);
    const applyBody =
      pluginSource.match(/private func apply\(_ session: Session\) \{\n[\s\S]*?\n {4}\}\n/)?.[0] ??
      '';
    expect(applyBody).toMatch(/setTrackSubscriptionPermissions\(\s*allParticipantsAllowed: false/);
    expect(applyBody).toContain('set(subscribed:');
  });

  it('answers only for the live session', () => {
    ['setKey', 'setMembers', 'setSound', 'setMicrophone', 'snapshot'].forEach((method) => {
      expect(body(method), method).toContain(
        'guard let session = self.session(call) else { return }'
      );
    });
    const sessionBody =
      pluginSource.match(
        /private func session\(_ call: CAPPluginCall\) -> Session\? \{\n[\s\S]*?\n {4}\}\n/
      )?.[0] ?? '';
    expect(sessionBody).toContain('"NOT_CONNECTED"');
  });

  it('sets no audio session category, logs nothing and notifies no listeners', () => {
    expect(pluginSource).not.toMatch(
      /setCategory\(|setActive\(|NSLog|print\(|CAPLog|os_log|notifyListeners\(/
    );
  });

  it('the voice recorder leaves the audio session alone during a call', () => {
    expect(recorderSource.match(/MindRoomCallPlugin\.liveSessions == 0/g)).toHaveLength(4);
    expect(
      recorderSource.match(/try session\.setCategory\(\.playAndRecord, mode: \.default\)/g)
    ).toHaveLength(1);
  });
});
