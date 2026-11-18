import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const pluginSource = read('ios/App/App/MindRoomVoiceRecorderPlugin.swift');
const bridgeSource = read('ios/App/App/MindRoomBridgeViewController.swift');
const sceneSource = read('ios/App/App/SceneDelegate.swift');
const projectSource = read('ios/App/App.xcodeproj/project.pbxproj');
const wrapperSource = read('src/app/native/nativeVoiceRecorder.ts');
/** The body of one plugin method, so that a check of one method cannot be met by another. */
const body = (method: string) =>
  pluginSource.match(
    new RegExp(`@objc func ${method}\\(_ call: CAPPluginCall\\) \\{\n[\\s\\S]*?\n {4}\\}\n`)
  )?.[0] ?? '';

describe('MindRoomVoiceRecorderPlugin native contract', () => {
  it('is the plugin the web side registers, with its methods and its level event', () => {
    expect(pluginSource).toContain('public let jsName = "MindRoomVoiceRecorder"');
    expect(wrapperSource).toContain("('MindRoomVoiceRecorder')");
    ['start', 'pause', 'resume', 'stop', 'cancel'].forEach((method) => {
      expect(pluginSource).toContain(
        `CAPPluginMethod(name: "${method}", returnType: CAPPluginReturnPromise)`
      );
      expect(pluginSource).toContain(`@objc func ${method}(_ call: CAPPluginCall)`);
    });
    expect(pluginSource).toContain('notifyListeners("level", data: ["level": level])');
    expect(pluginSource).toContain('call.resolve(["id": id])');
    expect(pluginSource).toContain('call.resolve(["path": ');
  });

  it('keeps each recording in a file of its own ID, a UUID, and acts only on the ID it is given', () => {
    expect(pluginSource).toContain('"\\(id).m4a"');
    expect(pluginSource).toContain('UUID(uuidString: id)');
    ['pause', 'resume', 'stop'].forEach((method) =>
      expect(body(method), method).toMatch(
        /^.*\n.*\n\s*guard let live = self\.live, live\.id == call\.getString\("id"\) else \{\s*return call\.reject\("No such recording", "NOT_RECORDING"\)/
      )
    );
    expect(body('resume')).toMatch(/guard live\.recorder\.record\(\) else \{\s*discardLive\(\)/);
  });

  it('cancels the recording of its ID and no other', () => {
    expect(body('cancel')).toMatch(
      /let id = call\.getString\("id"\) \?\? ""\s*if live\?\.id == id \{\s*discardLive\(\)\s*\} else if let url = Self\.file\(of: id\) \{\s*try\? FileManager\.default\.removeItem\(at: url\)\s*\}\s*call\.resolve\(\)/
    );
    expect(body('cancel')).not.toMatch(/clearFolder|epoch/);
  });

  it('records nothing for a page that went away under the microphone prompt', () => {
    expect(body('start')).toMatch(
      /let epoch = self\.epoch\s*AVCaptureDevice\.requestAccess\(for: \.audio\)[\s\S]*?DispatchQueue\.main\.async \{[\s\S]*?guard epoch == self\.epoch else[\s\S]*?setActive\(true\)/
    );
    expect(pluginSource).toMatch(/func cancelRecording\(\) \{\s*epoch \+= 1/);
  });

  it('leaves no file and no active audio session behind a start that fails', () => {
    expect(body('start')).toMatch(
      /attempt\?\.stop\(\)\s*try\? FileManager\.default\.removeItem\(at: url\)[\s\S]*?setActive\(false[\s\S]*?"START_FAILED"/
    );
  });

  it('rejects with the codes the web side names', () => {
    ['PERMISSION_DENIED', 'NO_MICROPHONE', 'START_FAILED', 'NOT_RECORDING'].forEach((code) =>
      expect(pluginSource).toContain(`"${code}"`)
    );
    ['PERMISSION_DENIED', 'NO_MICROPHONE'].forEach((code) => expect(wrapperSource).toContain(code));
  });

  it('asks for the microphone and records mono AAC at 16 kHz and 32 kbit/s, as the Watch does', () => {
    expect(pluginSource).toContain('AVCaptureDevice.requestAccess(for: .audio)');
    expect(pluginSource).toMatch(
      /AVFormatIDKey: kAudioFormatMPEG4AAC,\s*AVSampleRateKey: 16_000,\s*AVNumberOfChannelsKey: 1,\s*AVEncoderBitRateKey: 32_000/
    );
    expect(pluginSource).toContain('withTimeInterval: 0.08');
  });

  it('is on the main bridge of the Mac app only, compiled by both of its targets', () => {
    expect(bridgeSource).toMatch(
      /#if targetEnvironment\(macCatalyst\)\n(?:\s*\/\/.*\n)*\s*if !\(self is QuickCaptureViewController\) \{\n\s*bridge\?\.registerPluginInstance\(MindRoomVoiceRecorderPlugin\(\)\)\n\s*\}\n#endif/
    );
    expect(
      projectSource.match(/MindRoomVoiceRecorderPlugin\.swift in Sources \*\/,/g)
    ).toHaveLength(2);
  });

  it('releases the microphone when its page goes away and forgets a recording left behind', () => {
    expect(pluginSource).toContain('name: .capacitorWebViewNavigationStarted');
    expect(pluginSource).toMatch(/override public func load\(\) \{[\s\S]*?clearFolder\(\)/);
    expect(sceneSource).toMatch(
      /plugin\(withName: "MindRoomVoiceRecorder"\) as\? MindRoomVoiceRecorderPlugin\)\?\.cancelRecording\(\)[\s\S]*QuickCapture\.stopPage\(of: window\)/
    );
  });
});
