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
  it('is the plugin the web side registers, with its methods', () => {
    expect(pluginSource).toContain('public let jsName = "MindRoomVoiceRecorder"');
    expect(wrapperSource).toContain("('MindRoomVoiceRecorder')");
    ['start', 'level', 'pause', 'resume', 'stop', 'cancel'].forEach((method) => {
      expect(pluginSource).toContain(
        `CAPPluginMethod(name: "${method}", returnType: CAPPluginReturnPromise)`
      );
      expect(pluginSource).toContain(`@objc func ${method}(_ call: CAPPluginCall)`);
    });
    expect(body('level')).toContain(
      'call.resolve(["level": pow(10, live.recorder.averagePower(forChannel: 0) / 20)])'
    );
    // A listener notified from the main queue would race the bridge queue's listener changes.
    expect(pluginSource).not.toMatch(/notifyListeners\(|Timer/);
    expect(pluginSource).toContain('call.resolve(["id": id])');
    expect(pluginSource).toContain('call.resolve(["path": ');
  });

  it('keeps each recording in a file of its own ID, a UUID, and acts only on the ID it is given', () => {
    expect(pluginSource).toContain('"\\(id).m4a"');
    expect(pluginSource).toContain('UUID(uuidString: id)');
    ['level', 'pause', 'resume', 'stop'].forEach((method) =>
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
    expect(body('cancel')).not.toMatch(/clearFolder|closed/);
  });

  it('records only for the newest start of the page that is still loaded', () => {
    // The page names its newest start (the wrapper), and the plugin reads the name back from the
    // page loaded after the prompt: an older start of this page (its answer may come last), a
    // start of a page since replaced or being replaced, and one of a closed window end here.
    expect(wrapperSource).toMatch(
      /Object\.assign\(globalThis, \{ mindroomVoiceStart: nonce \}\);[\s\S]*?\.start\(\{ nonce \}\)/
    );
    const [before, after] = body('start').split(
      /evaluateJavaScript\("window\.mindroomVoiceStart"\) \{ newest, _ in\s*guard generation == self\.generation, !self\.closed, !webView\.isLoading,\s*let newest = newest as\? String, newest == call\.getString\("nonce"\) else \{\s*return call\.reject\("The page is gone", "START_FAILED"\)\s*\}/
    );
    // A closed or loading page is not asked for the microphone, and the navigation generation is
    // read before the prompt: a page load begun under it, also one that fails and leaves the old
    // page with its name, ends the start.
    expect(before).toMatch(
      /DispatchQueue\.main\.async \{\s*\/\/.*\s*guard !self\.closed, let webView = self\.bridge\?\.webView, !webView\.isLoading else \{\s*return call\.reject\("The page is gone", "START_FAILED"\)\s*\}\s*let generation = self\.generation\s*AVCaptureDevice\.requestAccess\(for: \.audio\) \{ granted in\s*DispatchQueue\.main\.async \{/
    );
    expect(before).not.toMatch(/live|setActive|AVAudioRecorder/);
    expect(after).toMatch(/self\.discardLive\(\)[\s\S]*?setActive\(true\)[\s\S]*?self\.live = /);
    expect(pluginSource).toMatch(
      /@objc private func pageWillLoad\(\) \{\s*generation \+= 1\s*discardLive\(\)\s*Self\.clearFolder\(\)\s*\}/
    );
    expect(pluginSource.match(/\bgeneration \+?= /g)).toEqual([
      'generation = ',
      'generation = ',
      'generation += ',
    ]);
    ['capacitorWebViewNavigationStarted', 'capacitorWebViewTerminated'].forEach((name) =>
      expect(pluginSource).toMatch(
        new RegExp(
          `selector: #selector\\(pageWillLoad\\), name: \\.${name},\\s*object: bridge\\?\\.webView`
        )
      )
    );
  });

  it('records nothing more once its window has closed', () => {
    expect(pluginSource).toMatch(/func close\(\) \{\s*closed = true\s*pageWillLoad\(\)\s*\}/);
    expect(pluginSource.match(/\bclosed = \w+/g)).toEqual(['closed = false', 'closed = true']);
  });

  it('leaves no file and no active audio session behind a start that fails', () => {
    expect(body('start')).toMatch(
      /attempt\?\.stop\(\)\s*try\? FileManager\.default\.removeItem\(at: url\)[\s\S]*?setActive\(false[\s\S]*?"START_FAILED"/
    );
  });

  it('records in a category that still lets the page play audio afterwards', () => {
    // The session keeps its category after a recording; `.record` would leave it input-only.
    expect(body('start')).toContain('try session.setCategory(.playAndRecord, mode: .default)');
    expect(pluginSource.match(/setCategory\(/g)).toHaveLength(1);
    expect(
      pluginSource.match(/setActive\(false, options: \.notifyOthersOnDeactivation\)/g)
    ).toHaveLength(3);
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
    expect(pluginSource).toMatch(/override public func load\(\) \{[\s\S]*?clearFolder\(\)/);
    expect(sceneSource).toMatch(
      /plugin\(withName: "MindRoomVoiceRecorder"\) as\? MindRoomVoiceRecorderPlugin\)\?\.close\(\)[\s\S]*QuickCapture\.stopPage\(of: window\)/
    );
  });
});
