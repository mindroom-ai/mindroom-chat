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
/** The body of a function of the plugin, of `RecordingLock` or of `Recording`. */
const func = (signature: string) =>
  pluginSource.match(
    new RegExp(
      `\n {4}(?:@objc )?(?:private )?(?:static )?(?:func |init)${signature} \\{\n[\\s\\S]*?\n {4}\\}\n`
    )
  )?.[0] ?? '';

describe('MindRoomVoiceRecorderPlugin native contract', () => {
  it('is the plugin the web side registers, with its methods', () => {
    expect(pluginSource).toContain('public let jsName = "MindRoomVoiceRecorder"');
    expect(wrapperSource).toContain("('MindRoomVoiceRecorder')");
    const methods = ['start', 'level', 'pause', 'resume', 'stop', 'forget', 'orphans'];
    methods.forEach((method) => {
      expect(pluginSource).toContain(`@objc func ${method}(_ call: CAPPluginCall)`);
      expect(wrapperSource).toContain(`  ${method}(`);
    });
    expect(pluginSource.match(/CAPPluginMethod\(name: "(\w+)"/g)).toHaveLength(methods.length);
    // The linear level is the RMS of the newest buffer the engine tapped.
    expect(body('level')).toContain('call.resolve(["level": recording.level])');
    expect(pluginSource).toMatch(
      /vDSP_rmsqv\(samples, 1, &rms, vDSP_Length\(buffer\.frameLength\)\)\s*newestLevel = min\(rms, 1\)/
    );
    // A listener notified from the main queue would race the bridge queue's listener changes.
    expect(pluginSource).not.toMatch(/notifyListeners\(|Timer/);
    expect(pluginSource).toContain('call.resolve(["id": id])');
  });

  it('keeps each recording in a file of its own UUID, and acts only on the ID it is given while it captures', () => {
    expect(func('file\\(of id: String\\) -> URL\\?')).toContain(
      'UUID(uuidString: id).map { folder.appendingPathComponent("\\($0.uuidString).m4a") }'
    );
    ['level', 'pause', 'resume', 'stop'].forEach((method) =>
      expect(body(method), method).toMatch(
        /^.*\n.*\n\s*guard let recording = capturing\(call\) else \{ return \}/
      )
    );
    // `capturing` is false from the moment a recording ends, also by itself.
    expect(func('capturing\\(_ call: CAPPluginCall\\) -> Recording\\?')).toMatch(
      /if let recording = writing\[call\.getString\("id"\) \?\? ""\], recording\.capturing \{ return recording \}\s*call\.reject\("No such recording", "NOT_RECORDING"\)\s*return nil/
    );
    expect(pluginSource.match(/capturing = \w+/g)).toEqual([
      'capturing = true',
      'capturing = false',
    ]);
    expect(body('resume')).toMatch(/guard recording\.resume\(\) else \{\s*recording\.end\(\)/);
  });

  it('deletes a file only for `forget`, and for a start that failed', () => {
    expect(pluginSource).toMatch(
      /FileManager\.default\.urls\(for: \.applicationSupportDirectory, in: \.userDomainMask\)\[0\]\s*\.appendingPathComponent\("MindRoomVoiceRecorder", isDirectory: true\)/
    );
    expect(pluginSource).not.toMatch(/temporaryDirectory|clearFolder|removeItem|deleteRecording/);
    // No call lets go of a file, and nothing is inferred from what the page did with one.
    expect(pluginSource + wrapperSource).not.toMatch(/keep\(|cancel\(|takers|delivered/);
    // One place unlinks, a method of the lock: regular files only, never what a link points at.
    expect(func('delete\\(\\) -> Bool')).toMatch(
      /\[file, lockFile\]\.allSatisfy \{ item in\s*var info = stat\(\)\s*guard lstat\(item\.path, &info\) == 0 else \{ return errno == ENOENT \}\s*return info\.st_mode & S_IFMT == S_IFREG && unlink\(item\.path\) == 0/
    );
    expect(pluginSource.match(/unlink\(/g)).toHaveLength(1);
    expect(pluginSource.match(/\.delete\(\)/g)).toHaveLength(2);
    expect(body('forget')).toMatch(
      /let delete = \{ \(lock: RecordingLock\) in\s*lock\.delete\(\) \? call\.resolve\(\) : call\.reject\("Could not delete the recording", "DELETE_FAILED"\)\s*\}/
    );
    // One this page still writes ends, and goes once its writer is done, under its own lock; any
    // other only under a lock taken now.
    expect(body('forget')).toMatch(
      /if let recording = writing\[id\] \{\s*recording\.end\(\)\s*recording\.whenDone \{ _, lock in delete\(lock\) \}\s*\} else if let lock = Self\.file\(of: id\)\.flatMap\(RecordingLock\.init\) \{\s*delete\(lock\)\s*\} else \{\s*call\.reject\("The recording is being written", "BUSY"\)/
    );
    // A failed start: what it wrote goes under the lock it took.
    expect(body('start')).toMatch(
      /guard let lock = Self\.file\(of: id\)\.flatMap\(RecordingLock\.init\) else \{\s*return call\.reject\("Could not start recording", "START_FAILED"\)\s*\}\s*guard let recording = try\? Recording\(lock: lock\) else \{\s*\/\/.*\s*_ = lock\.delete\(\)\s*return call\.reject\("Could not start recording", "START_FAILED"\)/
    );
    expect(pluginSource.match(/cancelWriting\(\)/g)).toHaveLength(1);
    expect(func('\\(lock: RecordingLock\\) throws')).toMatch(
      /do \{\s*try begin\(\)\s*\} catch \{\s*stopCapture\(\)\s*if writer\.status == \.writing \{ writer\.cancelWriting\(\) \}\s*throw error/
    );
  });

  it('holds the lock of a recording from its start until its writer is done', () => {
    // One object owns the descriptor: it has it only once the lock is taken, and closes it once.
    expect(func('\\?\\(_ file: URL\\)')).toMatch(
      /let descriptor = open\(lockFile\.path, O_RDWR \| O_CREAT \| O_NOFOLLOW \| O_CLOEXEC, 0o600\)\s*guard descriptor >= 0 else \{ return nil \}\s*guard flock\(descriptor, LOCK_EX \| LOCK_NB\) == 0 else \{\s*Darwin\.close\(descriptor\)\s*return nil\s*\}\s*\(self\.file, self\.lockFile, self\.descriptor\) = \(file, lockFile, descriptor\)/
    );
    expect(pluginSource).toContain('deinit { Darwin.close(descriptor) }');
    expect(pluginSource.match(/close\(descriptor\)/g)).toHaveLength(2);
    expect(pluginSource).not.toMatch(/Int32\?|unlock/);
    // The recording lets go of it in one place: when the writer finished or had failed, after
    // those that waited for it ran under it.
    expect(pluginSource.match(/lock = nil/g)).toHaveLength(1);
    expect(func('done\\(_ whole: Bool\\)')).toMatch(
      /DispatchQueue\.main\.async \{ \[self\] in\s*guard let lock else \{ return \}\s*waiters\.forEach \{ \$0\(whole, lock\) \}\s*waiters = \[\]\s*self\.lock = nil/
    );
    expect(pluginSource.match(/[^\w.]done\((?!_)/g)).toHaveLength(2);
    expect(func('seal\\(whole: Bool\\)')).toMatch(
      /guard phase != \.sealed else \{ return \}\s*phase = \.sealed\s*pending = \[\]\s*guard writer\.status == \.writing else \{ return done\(false\) \}\s*input\.markAsFinished\(\)\s*writer\.finishWriting \{ \[self\] in done\(whole && writer\.status == \.completed\) \}/
    );
    // The page's record of it goes then too.
    expect(body('start')).toMatch(
      /self\.writing\[id\] = recording\s*recording\.whenDone \{ \[weak self\] _, _ in self\?\.writing\[id\] = nil \}/
    );
    expect(pluginSource.match(/writing\[id\] = /g)).toHaveLength(2);
  });

  it('finishes what the writer took when it does not take the rest in time, and reports that stop as incomplete', () => {
    expect(func('end\\(\\)')).toMatch(
      /guard capturing else \{ return \}\s*capturing = false\s*stopCapture\(\)\s*queue\.async \{ \[self\] in\s*if phase == \.open \{ phase = \.closing \}\s*drain\(\)\s*queue\.asyncAfter\(deadline: \.now\(\) \+ 2\) \{ \[self\] in seal\(whole: false\) \}/
    );
    expect(body('stop')).toMatch(
      /recording\.end\(\)\s*recording\.whenDone \{ whole, _ in\s*guard whole else \{ return call\.reject\("The recording is incomplete", "INCOMPLETE"\) \}\s*call\.resolve\(\["path": recording\.url\.path\]\)/
    );
  });

  it('lists as orphans the files whose lock it can take, the lock first', () => {
    expect(body('orphans')).toMatch(
      /guard Self\.file\(of: id\)\?\.lastPathComponent == url\.lastPathComponent,\s*let startedAt = RecordingLock\(url\)\?\.startedAt else \{ return nil \}\s*return \["id": id, "path": url\.path, "startedAt": startedAt\]/
    );
    // Read under the lock: a regular file, not a link, and when it was made.
    expect(pluginSource).toMatch(
      /var startedAt: Int\? \{\s*var info = stat\(\)\s*guard lstat\(file\.path, &info\) == 0, info\.st_mode & S_IFMT == S_IFREG else \{ return nil \}\s*return info\.st_birthtimespec\.tv_sec \* 1_000 \+ info\.st_birthtimespec\.tv_nsec \/ 1_000_000/
    );
    expect(body('orphans')).toContain('call.resolve(["recordings": recordings])');
    expect(body('orphans')).not.toMatch(/writing\[|\.delete\(/);
  });

  it('writes a fragment each second, so a killed app leaves a file that plays up to it', () => {
    // AVAudioRecorder writes its `moov` only at a stop. AVAssetWriter writes a fragment each
    // second and joins them into one plain `.m4a` at a clean stop.
    expect(pluginSource).not.toMatch(/AVAudioRecorder\b/);
    expect(pluginSource).toContain(
      'writer = try AVAssetWriter(outputURL: lock.file, fileType: .m4a)'
    );
    expect(pluginSource).toContain(
      'writer.movieFragmentInterval = CMTime(seconds: 1, preferredTimescale: 600)'
    );
    // Each buffer's time is the length taken in before it, summed exactly at each buffer's own
    // rate, so a pause leaves no gap and a rate never rescales what came before.
    expect(pluginSource).toContain('presentationTimeStamp: written');
    expect(pluginSource).toContain(
      'written = CMTimeAdd(written, CMTime(value: CMTimeValue(buffer.frameLength), timescale: rate))'
    );
    expect(pluginSource).toMatch(
      /func pause\(\) \{ engine\.pause\(\) \}\s*func resume\(\) -> Bool \{ capturing && \(try\? engine\.start\(\)\) != nil \}/
    );
    expect(func('begin\\(\\) throws')).toMatch(
      /let format = node\.outputFormat\(forBus: 0\)\s*\/\/.*\s*guard format\.sampleRate > 0, format\.channelCount > 0, writer\.canAdd\(input\) else \{\s*throw/
    );
  });

  it('holds what the writer is not ready for, hands it on when it is ready again, and ends the recording on a write it cannot do', () => {
    // Also during a pause, when no buffer arrives to hand them on.
    expect(func('begin\\(\\) throws')).toMatch(
      /readiness = input\.observe\(\\\.isReadyForMoreMediaData\) \{ \[weak self\] _, _ in\s*self\?\.queue\.async \{ self\?\.drain\(\) \}/
    );
    expect(func('drain\\(\\)')).toMatch(
      /guard phase != \.sealed else \{ return \}\s*while let sample = pending\.first, input\.isReadyForMoreMediaData, input\.append\(sample\) \{\s*pending\.removeFirst\(\)\s*\}\s*if writer\.status != \.writing \{\s*fail\(\)\s*\} else if phase == \.closing, pending\.isEmpty \{\s*seal\(whole: true\)/
    );
    const append = func('append\\(_ buffer: AVAudioPCMBuffer\\)');
    expect(append).toMatch(/queue\.sync \{\s*guard phase == \.open else \{ return \}/);
    expect(append).toMatch(
      /\) == noErr else \{ return fail\(\) \}[\s\S]*pending\.append\(sample\)\s*drain\(\)\s*\/\/.*\s*if pending\.count > 64 \{ fail\(\) \}/
    );
    // What the writer took stays: the file is finished with it.
    expect(func('fail\\(\\)')).toMatch(
      /DispatchQueue\.main\.async \{ \[self\] in end\(\) \}\s*seal\(whole: false\)/
    );
    expect(pluginSource).not.toMatch(/usleep|sleep\(/);
  });

  it('ends a recording whose device changed or was interrupted, from the main queue, the audio session last', () => {
    const begin = func('begin\\(\\) throws');
    // In place before the engine starts; each only asks for the end.
    expect(begin).toMatch(
      /\(Notification\.Name\.AVAudioEngineConfigurationChange, engine as Any\),\s*\(AVAudioSession\.interruptionNotification, session as Any\)\s*\]\.map \{ name, object in\s*NotificationCenter\.default\.addObserver\(forName: name, object: object, queue: nil\) \{ \[weak self\] _ in\s*DispatchQueue\.main\.async \{ self\?\.end\(\) \}/
    );
    expect(begin.indexOf('addObserver(')).toBeLessThan(begin.indexOf('installTap('));
    expect(begin.indexOf('installTap(')).toBeLessThan(begin.indexOf('try engine.start()'));
    expect(begin.indexOf('try engine.start()')).toBeGreaterThan(0);
    // One function lets go of the microphone.
    expect(func('stopCapture\\(\\)')).toMatch(
      /observers\.forEach\(NotificationCenter\.default\.removeObserver\)\s*engine\.inputNode\.removeTap\(onBus: 0\)\s*engine\.stop\(\)\s*try\? AVAudioSession\.sharedInstance\(\)\.setActive\(false, options: \.notifyOthersOnDeactivation\)/
    );
    expect(pluginSource.match(/setActive\(false|engine\.stop\(\)|removeTap\(/g)).toHaveLength(3);
    // The page learns it from its next call, which rejects `NOT_RECORDING`; a level that fails
    // any other way is asked again.
    expect(wrapperSource).toMatch(
      /\(error\?: \{ code\?: string \}\) => \{\s*if \(error\?\.code === 'NOT_RECORDING'\) this\.stop\(\);/
    );
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
    expect(before).not.toMatch(/writing|Recording/);
    // What still captures ends first; its file stays.
    expect(after).toMatch(
      /self\.writing\.values\.forEach \{ \$0\.end\(\) \}[\s\S]*?RecordingLock\.init[\s\S]*?Recording\(lock: lock\)/
    );
    expect(pluginSource).toMatch(
      /@objc private func pageWillLoad\(\) \{\s*generation \+= 1\s*writing\.values\.forEach \{ \$0\.end\(\) \}\s*\}/
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
    expect(sceneSource).toMatch(
      /plugin\(withName: "MindRoomVoiceRecorder"\) as\? MindRoomVoiceRecorderPlugin\)\?\.close\(\)[\s\S]*QuickCapture\.stopPage\(of: window\)/
    );
  });

  it('records in a category that still lets the page play audio afterwards', () => {
    // The session keeps its category after a recording; `.record` would leave it input-only.
    expect(func('begin\\(\\) throws')).toMatch(
      /try session\.setCategory\(\.playAndRecord, mode: \.default\)\s*try session\.setActive\(true\)/
    );
    expect(pluginSource.match(/setCategory\(|setActive\(true/g)).toHaveLength(2);
  });

  it('rejects with the codes the web side names', () => {
    ['PERMISSION_DENIED', 'NO_MICROPHONE', 'START_FAILED', 'NOT_RECORDING'].forEach((code) =>
      expect(pluginSource).toContain(`"${code}"`)
    );
    ['PERMISSION_DENIED', 'NO_MICROPHONE', 'NOT_RECORDING'].forEach((code) =>
      expect(wrapperSource).toContain(code)
    );
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
});
