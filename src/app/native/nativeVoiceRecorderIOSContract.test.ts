import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// These read the Swift source; the behaviour itself was checked on a Mac (the plan, Task 3).
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
/** The body of a function of the plugin or of `Recording`. */
const func = (signature: string) =>
  pluginSource.match(
    new RegExp(
      `\n {4}(?:@objc )?(?:private )?(?:static )?func ${signature} \\{\n[\\s\\S]*?\n {4}\\}\n`
    )
  )?.[0] ?? '';

describe('MindRoomVoiceRecorderPlugin native contract', () => {
  it('is the plugin the web side registers, with its methods', () => {
    expect(pluginSource).toContain('public let jsName = "MindRoomVoiceRecorder"');
    expect(wrapperSource).toContain("('MindRoomVoiceRecorder')");
    ['start', 'level', 'pause', 'resume', 'stop', 'cancel', 'keep', 'orphans'].forEach((method) => {
      expect(pluginSource).toContain(
        `CAPPluginMethod(name: "${method}", returnType: CAPPluginReturnPromise)`
      );
      expect(pluginSource).toContain(`@objc func ${method}(_ call: CAPPluginCall)`);
      expect(wrapperSource).toContain(`  ${method}(`);
    });
    // The linear level is the RMS of the newest buffer the engine tapped.
    expect(body('level')).toContain('call.resolve(["level": live.level])');
    expect(pluginSource).toMatch(
      /vDSP_rmsqv\(samples, 1, &rms, vDSP_Length\(buffer\.frameLength\)\)\s*newestLevel = min\(rms, 1\)/
    );
    // A listener notified from the main queue would race the bridge queue's listener changes.
    expect(pluginSource).not.toMatch(/notifyListeners\(|Timer/);
    expect(pluginSource).toContain('call.resolve(["id": id])');
  });

  it('keeps each recording in a file of its own UUID, one name per recording, and acts only on the ID it is given', () => {
    expect(func('file\\(of id: String\\) -> URL\\?')).toContain(
      'UUID(uuidString: id).map { folder.appendingPathComponent("\\($0.uuidString).m4a") }'
    );
    ['level', 'pause', 'resume', 'stop'].forEach((method) =>
      expect(body(method), method).toMatch(
        /^.*\n.*\n\s*guard let live = self\.live, live\.id == call\.getString\("id"\) else \{\s*return call\.reject\("No such recording", "NOT_RECORDING"\)/
      )
    );
    expect(body('resume')).toMatch(
      /guard live\.resume\(\) else \{\s*endIfLive\(live\)\s*live\.finish \{ _ in \}/
    );
  });

  it('writes a fragment each second, so a killed app leaves a file that plays up to it', () => {
    // AVAudioRecorder writes its `moov` only at a stop. AVAssetWriter writes a fragment each
    // second and joins them into one plain `.m4a` at a clean stop.
    expect(pluginSource).not.toMatch(/AVAudioRecorder\b/);
    expect(pluginSource).toContain('writer = try AVAssetWriter(outputURL: url, fileType: .m4a)');
    expect(pluginSource).toContain(
      'writer.movieFragmentInterval = CMTime(seconds: 1, preferredTimescale: 600)'
    );
    // Each buffer's time is the length written before it, summed exactly at each buffer's own
    // rate, so a pause leaves no gap and a rate never rescales what came before.
    expect(pluginSource).toContain('presentationTimeStamp: written');
    expect(pluginSource).toContain(
      'written = CMTimeAdd(written, CMTime(value: CMTimeValue(buffer.frameLength), timescale: rate))'
    );
    expect(pluginSource).toMatch(
      /func pause\(\) \{\s*engine\.pause\(\)\s*\}\s*func resume\(\) -> Bool \{\s*!finishing && \(try\? engine\.start\(\)\) != nil\s*\}/
    );
    // An input without a rate or a channel records nothing.
    expect(pluginSource).toMatch(
      /let format = node\.outputFormat\(forBus: 0\)\s*guard format\.sampleRate > 0, format\.channelCount > 0 else \{ throw/
    );
  });

  it('holds what the writer is not ready for, and ends the recording on a write it cannot do', () => {
    expect(func('append\\(_ buffer: AVAudioPCMBuffer\\)')).toMatch(
      /\) == noErr else \{ return fail\(\) \}[\s\S]*pending\.append\(sample\)\s*\/\/.*\s*guard drain\(\), pending\.count <= 64 else \{ return fail\(\) \}/
    );
    expect(func('drain\\(\\) -> Bool')).toMatch(
      /while let sample = pending\.first, input\.isReadyForMoreMediaData \{\s*guard input\.append\(sample\) else \{ return false \}\s*pending\.removeFirst\(\)\s*\}\s*return writer\.status == \.writing/
    );
    expect(func('fail\\(\\)')).toMatch(
      /ended = true\s*DispatchQueue\.main\.async \{ \[self\] in interrupt\(\) \}/
    );
    // A stop resolves only a file finished whole; another stays held for the page to keep.
    const finish = func('finish\\(then done: @escaping \\(Bool\\) -> Void\\)');
    expect(finish).toMatch(/engine\.inputNode\.removeTap\(onBus: 0\)\s*engine\.stop\(\)/);
    expect(finish).toMatch(
      /guard pending\.isEmpty, writer\.status == \.writing else \{ return settle\(false\) \}\s*input\.markAsFinished\(\)\s*writer\.finishWriting \{ \[self\] in settle\(writer\.status == \.completed\) \}/
    );
    expect(body('stop')).toMatch(
      /guard written else \{ return call\.reject\("Could not finish the recording", "STOP_FAILED"\) \}\s*call\.resolve\(\["path": live\.url\.path\]\)/
    );
  });

  it('ends a recording whose device changed or was interrupted, keeping what it wrote', () => {
    expect(pluginSource).toMatch(
      /\(Notification\.Name\.AVAudioEngineConfigurationChange, engine as Any\),\s*\(AVAudioSession\.interruptionNotification, AVAudioSession\.sharedInstance\(\) as Any\)/
    );
    expect(func('interrupt\\(\\)')).toMatch(
      /guard !finishing else \{ return \}\s*finish \{ _ in \}\s*onInterrupt\?\(\)/
    );
    // The page learns it from its next call (level), and keeps the file.
    expect(body('start')).toMatch(
      /recording\.onInterrupt = \{ \[weak self, weak recording\] in\s*if let self, let recording \{ self\.endIfLive\(recording\) \}/
    );
  });

  it('keeps its files in Application Support and deletes one only for a failed start or a cancel', () => {
    expect(pluginSource).toMatch(
      /FileManager\.default\.urls\(for: \.applicationSupportDirectory, in: \.userDomainMask\)\[0\]\s*\.appendingPathComponent\("MindRoomVoiceRecorder", isDirectory: true\)/
    );
    expect(pluginSource).not.toMatch(/temporaryDirectory|clearFolder|removeItem|deleteRecording/);
    // Regular files only, never what a link points at.
    expect(func('delete\\(_ id: String\\) -> Bool')).toMatch(
      /guard lstat\(item\.path, &info\) == 0 else \{ return errno == ENOENT \}\s*return info\.st_mode & S_IFMT == S_IFREG && unlink\(item\.path\) == 0/
    );
    expect(pluginSource.match(/Self\.delete\(id\)/g)).toHaveLength(3);
    expect(body('start').match(/Self\.delete\(id\)/g)).toHaveLength(1);
    expect(body('cancel').match(/Self\.delete\(id\)/g)).toHaveLength(2);
  });

  it('deletes a held recording only after its file is written, and settles a pending stop as canceled', () => {
    expect(body('cancel')).toMatch(
      /if let recording = held\.removeValue\(forKey: id\) \{\s*endIfLive\(recording\)\s*recording\.finish \{ _ in\s*let deleted = Self\.delete\(id\)\s*recording\.unlock\(\)\s*settle\(deleted\)/
    );
    // An orphan only while no window or process holds it.
    expect(body('cancel')).toMatch(
      /\} else if let lock = Self\.lock\(id\) \{\s*let deleted = Self\.delete\(id\)\s*Darwin\.close\(lock\)\s*settle\(deleted\)\s*\} else \{\s*call\.reject\("The recording is held elsewhere", "BUSY"\)/
    );
    expect(body('cancel')).toContain(
      'deleted ? call.resolve() : call.reject("Could not delete the recording", "DELETE_FAILED")'
    );
    // The stop's waiter runs before the cancel's: the cancel already let go of it.
    expect(body('stop')).toContain(
      'guard held[live.id] === live else { return call.reject("The recording was canceled", "CANCELED") }'
    );
    expect(func('finish\\(then done: @escaping \\(Bool\\) -> Void\\)')).toMatch(
      /if let finished \{ return done\(finished\) \}\s*waiters\.append\(done\)\s*guard !finishing else \{ return \}/
    );
  });

  it('lists as orphans the files whose lock no window or process holds', () => {
    // The kernel drops a lock when its process ends.
    expect(func('lock\\(_ id: String\\) -> Int32\\?')).toMatch(
      /open\(url\.path, O_RDWR \| O_CREAT \| O_NOFOLLOW \| O_CLOEXEC, 0o600\)[\s\S]*flock\(fd, LOCK_EX \| LOCK_NB\) == 0/
    );
    expect(body('start')).toMatch(
      /lock = Self\.lock\(id\)\s*guard let lock else \{ throw CocoaError\(\.fileWriteUnknown\) \}[\s\S]*?let recording = try Recording\(id: id, url: url, lock: lock\)\s*self\.live = recording\s*self\.held\[id\] = recording/
    );
    expect(body('orphans')).toMatch(
      /guard Self\.file\(of: id\)\?\.lastPathComponent == url\.lastPathComponent, Self\.isRegularFile\(url\),\s*let lock = Self\.lock\(id\) else \{ return nil \}\s*Darwin\.close\(lock\)/
    );
    expect(body('orphans')).toContain(
      'return ["id": id, "path": url.path, "startedAt": Int(startedAt.timeIntervalSince1970 * 1_000)]'
    );
    expect(body('orphans')).toContain('call.resolve(["recordings": recordings])');
    // Its lock goes once the file is written.
    expect(func('keep\\(_ recording: Recording\\)')).toMatch(
      /endIfLive\(recording\)\s*held\[recording\.id\] = nil\s*recording\.finish \{ _ in recording\.unlock\(\) \}/
    );
    expect(body('keep')).toContain('held[call.getString("id") ?? ""].map(keep)');
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
    expect(before).not.toMatch(/live|setActive|Recording/);
    expect(after).toMatch(
      /self\.live\.map\(self\.keep\)[\s\S]*?setActive\(true\)[\s\S]*?self\.live = /
    );
    expect(pluginSource).toMatch(
      /@objc private func pageWillLoad\(\) \{\s*generation \+= 1\s*Array\(held\.values\)\.forEach\(keep\)\s*\}/
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

  it('leaves no file, lock or active audio session behind a start that fails', () => {
    expect(body('start')).toMatch(
      /\} catch \{\s*_ = Self\.delete\(id\)\s*if let lock \{ Darwin\.close\(lock\) \}\s*try\? session\.setActive\(false[\s\S]*?"START_FAILED"/
    );
    // A recording that fails to start lets go of the microphone and of its writer.
    expect(pluginSource).toMatch(
      /try engine\.start\(\)\s*\} catch \{\s*node\.removeTap\(onBus: 0\)\s*writer\.cancelWriting\(\)\s*throw error/
    );
  });

  it('records in a category that still lets the page play audio afterwards', () => {
    // The session keeps its category after a recording; `.record` would leave it input-only.
    expect(body('start')).toContain('try session.setCategory(.playAndRecord, mode: .default)');
    expect(pluginSource.match(/setCategory\(/g)).toHaveLength(1);
    expect(
      pluginSource.match(/setActive\(false, options: \.notifyOthersOnDeactivation\)/g)
    ).toHaveLength(2);
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

  it('releases the microphone when its window closes and keeps the recording for the next page', () => {
    expect(func('endIfLive\\(_ recording: Recording\\)')).toMatch(
      /guard live === recording else \{ return \}\s*live = nil\s*try\? AVAudioSession\.sharedInstance\(\)\.setActive\(false/
    );
    expect(sceneSource).toMatch(
      /plugin\(withName: "MindRoomVoiceRecorder"\) as\? MindRoomVoiceRecorderPlugin\)\?\.close\(\)[\s\S]*QuickCapture\.stopPage\(of: window\)/
    );
  });
});
