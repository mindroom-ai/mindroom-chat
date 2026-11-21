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
    ['start', 'level', 'pause', 'resume', 'stop', 'cancel', 'listLeftovers', 'clear'].forEach(
      (method) => {
        expect(pluginSource).toContain(
          `CAPPluginMethod(name: "${method}", returnType: CAPPluginReturnPromise)`
        );
        expect(pluginSource).toContain(`@objc func ${method}(_ call: CAPPluginCall)`);
      }
    );
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
    expect(body('start')).toContain('let id = UUID().uuidString');
    expect(pluginSource).toContain('guard let recording = recordings[id] else { return }');
    ['level', 'pause', 'resume', 'stop'].forEach((method) =>
      expect(body(method), method).toMatch(
        /^.*\n.*\n\s*guard let live = self\.live, live\.id == call\.getString\("id"\) else \{\s*return call\.reject\("No such recording", "NOT_RECORDING"\)/
      )
    );
    expect(body('resume')).toMatch(/guard live\.recorder\.record\(\) else \{\s*discardLive\(\)/);
  });

  it('does not cancel another window’s live recording and rejects removal errors', () => {
    expect(body('cancel')).toMatch(
      /let plugin = Self\.recordings\[id\]\?\.plugin\s*guard plugin == nil \|\| plugin === self[\s\S]*?call\.reject[\s\S]*?try Self\.removeFile\(id\)[\s\S]*?catch \{ return call\.reject\("Could not remove recording"/
    );
    expect(body('cancel')).not.toMatch(/clearFolder|closed/);
    expect(pluginSource).toContain('catch CocoaError.fileNoSuchFile');
  });

  it('records only for the newest start of the page that is still loaded', () => {
    // The page names its newest start (the wrapper), and the plugin reads the name back from the
    // page loaded after the prompt: an older start of this page (its answer may come last), a
    // start of a page since replaced or being replaced, and one of a closed window end here.
    expect(wrapperSource).toMatch(
      /Object\.assign\(globalThis, \{ mindroomVoiceStart: nonce \}\);[\s\S]*?\.start\(\{ nonce, userId \}\)/
    );
    const [before, after] = body('start').split(
      /evaluateJavaScript\("window\.mindroomVoiceStart"\) \{ newest, _ in\s*guard generation == self\.generation, !self\.closed, !webView\.isLoading,\s*ownerGeneration == Self\.ownerGenerations\[userId, default: 0\],\s*let newest = newest as\? String, newest == call\.getString\("nonce"\) else \{\s*return call\.reject\("The page is gone", "START_FAILED"\)\s*\}/
    );
    // A closed or loading page is not asked for the microphone, and the navigation generation is
    // read before the prompt: a page load begun under it, also one that fails and leaves the old
    // page with its name, ends the start.
    expect(before).toMatch(
      /DispatchQueue\.main\.async \{\s*\/\/.*\s*guard !self\.closed, let webView = self\.bridge\?\.webView, !webView\.isLoading,\s*let userId = call\.getString\("userId"\), !userId\.isEmpty else \{\s*return call\.reject\("Could not start recording", "START_FAILED"\)\s*\}[\s\S]*?let generation = self\.generation\s*AVCaptureDevice\.requestAccess\(for: \.audio\) \{ granted in\s*DispatchQueue\.main\.async \{/
    );
    expect(before).not.toMatch(/live|setActive|AVAudioRecorder/);
    expect(after).toMatch(/self\.discardLive\(\)[\s\S]*?setActive\(true\)[\s\S]*?self\.live = /);
    expect(pluginSource).toMatch(
      /@objc private func pageWillLoad\(\) \{\s*generation \+= 1\s*finishLive\(\)\s*\}/
    );
    const finish = pluginSource.match(/private func finishLive\(\) \{[\s\S]*?\n {4}\}/)?.[0];
    expect(finish).toContain('live.recorder.stop()');
    expect(finish).not.toMatch(/deleteRecording|discardLive|clearFolder/);
    expect(pluginSource.match(/\bgeneration \+?= /g)).toEqual([
      'generation = ',
      'generation = ',
      'generation += ',
    ]);
    expect(pluginSource).toContain(
      '[.capacitorWebViewNavigationStarted, .capacitorWebViewTerminated]'
    );
    expect(pluginSource).toMatch(
      /for name in pageEvents \{\s*NotificationCenter\.default\.addObserver\(self, selector: #selector\(pageWillLoad\), name: name, object: bridge\?\.webView\)/
    );
  });

  it('records nothing more once its window has closed', () => {
    expect(pluginSource).toMatch(
      /func close\(\) \{[\s\S]*?closed = true\s*discardLive\(\)\s*Self\.instances -= 1\s*if Self\.instances == 0 \{ Self\.clearFolder\(\)/
    );
    expect(pluginSource.match(/\bclosed = \w+/g)).toEqual(['closed = false', 'closed = true']);
  });

  it('leaves no file and no active audio session behind a start that fails', () => {
    expect(body('start')).toMatch(
      /attempt\?\.stop\(\)\s*try\? FileManager\.default\.removeItem\(at: url\)[\s\S]*?Self\.deactivateIfIdle\(\)[\s\S]*?"START_FAILED"/
    );
  });

  it('records in a category that still lets the page play audio afterwards', () => {
    // The session keeps its category after a recording; `.record` would leave it input-only.
    expect(body('start')).toContain('try session.setCategory(.playAndRecord, mode: .default)');
    expect(pluginSource.match(/setCategory\(/g)).toHaveLength(1);
    expect(
      pluginSource.match(/setActive\(false, options: \.notifyOthersOnDeactivation\)/g)
    ).toHaveLength(1);
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

  it('lists only finished UUID audio files and their recovery metadata', () => {
    const leftover = body('listLeftovers');
    expect(leftover).toMatch(
      /Self\.recordings\.compactMap \{ id, recording in\s*let url = Self\.file\(of: id\)\s*guard recording\.plugin == nil,/
    );
    expect(leftover).toContain('creationDate');
    expect(leftover).toMatch(/AVAudioPlayer\(contentsOf: url\)[\s\S]*player\.duration > 0/);
    expect(leftover).toContain('["id": id, "path": url.path, "startedAt":');
    expect(leftover).toContain('"userId": recording.owner');
    expect(leftover).toContain('"duration":');
  });

  it('invalidates pending permission and clears that account’s recordings on sign-out', () => {
    expect(body('clear')).toMatch(
      /Self\.ownerGenerations\[userId, default: 0\] \+= 1[\s\S]*?for \(id, recording\) in Self\.recordings where recording\.owner == userId \{\s*try\? Self\.removeFile\(id, discard: true\)/
    );
  });

  it('clears leftovers on plugin load and closes with its window', () => {
    expect(pluginSource).toMatch(
      /override public func load\(\) \{[\s\S]*?if Self\.instances == 0 \{ Self\.clearFolder\(\) \}/
    );
    expect(sceneSource).toMatch(
      /plugin\(withName: "MindRoomVoiceRecorder"\) as\? MindRoomVoiceRecorderPlugin\)\?\.close\(\)[\s\S]*QuickCapture\.stopPage\(of: window\)/
    );
  });
});
