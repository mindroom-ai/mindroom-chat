import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// These read the Swift source: the shape of the bridge, and a few rules no edit may break. What
// the recorder does is checked on a Mac (docs/mac-voice-probe/README.md).
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
    new RegExp(`\n {4}(?:private )?func ${signature} \\{\n[\\s\\S]*?\n {4}\\}\n`)
  )?.[0] ?? '';
const count = (pattern: RegExp, source = pluginSource) => source.match(pattern)?.length ?? 0;

describe('MindRoomVoiceRecorderPlugin native contract', () => {
  it('is the plugin the web side registers, with its methods and answers', () => {
    expect(pluginSource).toContain('public let jsName = "MindRoomVoiceRecorder"');
    expect(wrapperSource).toContain("('MindRoomVoiceRecorder')");
    const methods = ['start', 'level', 'pause', 'resume', 'stop', 'forget', 'orphans'];
    methods.forEach((method) => {
      expect(pluginSource).toContain(
        `CAPPluginMethod(name: "${method}", returnType: CAPPluginReturnPromise)`
      );
      expect(body(method), method).not.toBe('');
      expect(wrapperSource).toContain(`  ${method}(`);
    });
    expect(count(/CAPPluginMethod\(name: /g)).toBe(methods.length);
    // What the wrapper reads from each answer.
    expect(body('start')).toContain('call.resolve(["id": id])');
    expect(body('start')).toContain('call.getString("owner")');
    expect(body('level')).toContain('call.resolve(["level": recording.level])');
    expect(body('stop')).toContain(
      'call.resolve(["path": recording.url.path, "incomplete": !whole])'
    );
    expect(body('orphans')).toContain(
      'return ["id": id, "path": url.path, "startedAt": startedAt, "owner": lock.owner]'
    );
    // A listener notified from the main queue would race the bridge queue's listener changes.
    expect(pluginSource).not.toMatch(/notifyListeners\(|Timer/);
  });

  it('rejects with the codes the web side names', () => {
    [
      'PERMISSION_DENIED',
      'NO_MICROPHONE',
      'START_FAILED',
      'NOT_RECORDING',
      'INVALID_ID',
      'BUSY',
      'DELETE_FAILED',
    ].forEach((code) => expect(pluginSource).toContain(`"${code}"`));
    ['PERMISSION_DENIED', 'NO_MICROPHONE', 'NOT_RECORDING'].forEach((code) =>
      expect(wrapperSource).toContain(code)
    );
    // An ended recording still answers a stop: only what needs a live one rejects.
    expect(body('stop')).not.toContain('capturing(call)');
    ['level', 'pause', 'resume'].forEach((method) =>
      expect(body(method), method).toContain('guard let recording = capturing(call) else')
    );
  });

  it('deletes a file only for `forget`, and for a start that failed', () => {
    expect(pluginSource).not.toMatch(
      /temporaryDirectory|removeItem|trashItem|deleteRecording|cancel\(|keep\(/
    );
    // One place unlinks, a method of the lock, and two places call it.
    expect(count(/unlink\(/g)).toBe(1);
    expect(func('delete\\(\\) -> Bool')).toContain('unlink(item.path)');
    expect(count(/\.delete\(\)/g)).toBe(2);
    expect(count(/lock\.delete\(\)/g, body('forget'))).toBe(1);
    expect(count(/lock\.delete\(\)/g, body('start'))).toBe(1);
    // In the start, only where it fails.
    expect(body('start')).toMatch(
      /_ = lock\.delete\(\)\s*return call\.reject\("Could not start recording", "START_FAILED"\)/
    );
  });

  it('holds each lock until the writer is done, and makes a lock file only to write or delete', () => {
    // The kernel drops the lock of a process that dies.
    expect(pluginSource).toContain('flock(descriptor, LOCK_EX | LOCK_NB) == 0');
    // One owner closes the descriptor: where the lock is not got, and when it is let go.
    expect(count(/close\(descriptor\)/g)).toBe(2);
    // A recording lets go of its lock in one place: when its writer finished or had failed.
    expect(count(/\block = nil/g)).toBe(1);
    expect(func('done\\(_ whole: Bool\\)')).toMatch(/\block = nil/);

    // A listing takes locks that exist and makes none.
    expect(pluginSource).toContain('(create ? O_CREAT : 0)');
    expect(count(/O_CREAT/g)).toBe(1);
    expect(body('orphans')).toContain('RecordingLock(url, create: false)');
    expect(count(/create: true/g)).toBe(
      count(/create: true/g, body('start')) + count(/create: true/g, body('forget'))
    );
  });

  it('keeps the tap and the level off the queue of the writer, which may wait for the disk', () => {
    expect(pluginSource).not.toMatch(/queue\.sync|usleep|sleep\(/);
  });

  it('taps the format of the hardware, not one the node may still hold from the device before', () => {
    expect(pluginSource).toContain('let format = node.inputFormat(forBus: 0)');
    expect(pluginSource).not.toContain('outputFormat(forBus');
    expect(count(/installTap\(/g)).toBe(1);
  });

  it('records only for the newest start of the page that is still loaded', () => {
    // The page names its newest start (the wrapper), and the plugin reads the name back from the
    // page loaded after the prompt: an older start of this page (its answer may come last), a
    // start of a page since replaced or being replaced, and one of a closed window end here.
    expect(wrapperSource).toMatch(
      /Object\.assign\(globalThis, \{ mindroomVoiceStart: nonce \}\);[\s\S]*?\.start\(\{ nonce, owner \}\)/
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
    expect(before).not.toMatch(/recordings|Recording/);
    expect(after).toMatch(/Recording\(lock: lock\)/);
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
    expect(pluginSource).toContain('try session.setCategory(.playAndRecord, mode: .default)');
    expect(count(/setCategory\(/g)).toBe(1);
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
