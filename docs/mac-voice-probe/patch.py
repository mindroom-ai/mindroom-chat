#!/usr/bin/env python3
"""Adds the debug hooks of docs/mac-voice-probe/README.md to a checkout, for a probe build only.

Usage: python3 docs/mac-voice-probe/patch.py <checkout>. Never commit its result: `git checkout --
ios/App/App` undoes it. Each hook is asked for by an environment variable of the app (README.md).
An anchor that is gone means the plugin changed: move the hook to the new code.
"""
import sys

root = sys.argv[1]


def patch(path, pairs):
    text = open(path).read()
    for old, new in pairs:
        assert text.count(old) == 1, (path, old, text.count(old))
        text = text.replace(old, new)
    open(path, "w").write(text)


patch(root + "/ios/App/App/MindRoomVoiceRecorderPlugin.swift", [
    # A way for the page's script to write to the app's log.
    ('''        CAPPluginMethod(name: "orphans", returnType: CAPPluginReturnPromise)
''', '''        CAPPluginMethod(name: "orphans", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "probeLog", returnType: CAPPluginReturnPromise)
'''),
    ('''    @objc func start(_ call: CAPPluginCall) {
''', '''    @objc func probeLog(_ call: CAPPluginCall) {
        NSLog("MindRoom voice probe: %@", call.getString("text") ?? "")
        call.resolve()
    }

    @objc func start(_ call: CAPPluginCall) {
'''),
    # SLOW: a writer that stops taking data (not real-time, and a second input that gets none).
    ('''        input.expectsMediaDataInRealTime = true
''', '''        input.expectsMediaDataInRealTime = Recording.probe["MINDROOM_VOICE_SLOW"] == nil
'''),
    ('''        writer.add(input)
''', '''        writer.add(input)
        if Recording.probe["MINDROOM_VOICE_SLOW"] != nil {
            let other = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16_000, AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 32_000
            ])
            if writer.canAdd(other) {
                writer.add(other)
                probeOther = other
            }
        }
'''),
    # RECONFIG=<s>,<s>: what a changed device does (the engine stops, then its notification comes
    # off the main queue). INTERRUPT=<s>: an interruption. BLOCK=<s>,<length>: the writer's queue
    # hangs, as in an append that does not return.
    ('''        try tap()
        try engine.start()
    }
''', '''        let seconds = { (name: String) in (Recording.probe[name] ?? "").split(separator: ",").compactMap { Double($0) } }
        for after in seconds("MINDROOM_VOICE_RECONFIG") {
            DispatchQueue.main.asyncAfter(deadline: .now() + after) { [weak self] in
                guard let self else { return }
                self.engine.stop()
                NSLog("MindRoom voice probe: the engine stopped; posting AVAudioEngineConfigurationChange")
                DispatchQueue.global().async {
                    NotificationCenter.default.post(name: .AVAudioEngineConfigurationChange, object: self.engine)
                }
            }
        }
        if let after = seconds("MINDROOM_VOICE_INTERRUPT").first {
            DispatchQueue.global().asyncAfter(deadline: .now() + after) {
                NSLog("MindRoom voice probe: posting AVAudioSession.interruptionNotification")
                NotificationCenter.default.post(name: AVAudioSession.interruptionNotification, object: session)
            }
        }
        let block = seconds("MINDROOM_VOICE_BLOCK")
        if block.count == 2 {
            queue.asyncAfter(deadline: .now() + block[0]) {
                NSLog("MindRoom voice probe: the writer's queue hangs for %.0f s", block[1])
                Thread.sleep(forTimeInterval: block[1])
                NSLog("MindRoom voice probe: the writer's queue goes on")
            }
        }
        try tap()
        try engine.start()
    }
'''),
    # EMPTY=<n>: the next n taps after the first find a device without a format.
    # RATE=<Hz> [CHANNELS=<n>]: after a device change the device delivers that format.
    ('''        let format = node.inputFormat(forBus: 0)
''', '''        let format = node.inputFormat(forBus: 0)
        probeTaps += 1
        if probeTaps > 1, probeTaps - 1 <= Int(Recording.probe["MINDROOM_VOICE_EMPTY"] ?? "") ?? 0 {
            NSLog("MindRoom voice probe: tap %d finds no format", probeTaps)
            throw CocoaError(.fileWriteUnknown)
        }
        let other = Recording.probe["MINDROOM_VOICE_RATE"].flatMap { Double($0) }.flatMap {
            AVAudioFormat(standardFormatWithSampleRate: $0, channels: AVAudioChannelCount(Recording.probe["MINDROOM_VOICE_CHANNELS"] ?? "1") ?? 1)
        }
        let delivered = (probeTaps == 1 ? nil : other) ?? format
        NSLog("MindRoom voice probe: tap %d: hardware %@, node output %@, delivered %@", probeTaps, String(describing: format),
              String(describing: node.outputFormat(forBus: 0)), String(describing: delivered))
'''),
    # TONE: the lid is closed and the microphone records silence, so each buffer is replaced by a
    # 440 Hz tone of the same length in the delivered format, its phase running on.
    ('''        node.installTap(onBus: 0, bufferSize: 4_096, format: format) { [weak self] buffer, _ in
''', '''        node.installTap(onBus: 0, bufferSize: 4_096, format: format) { [weak self] buffer, _ in
            var buffer = buffer
            if Recording.probe["MINDROOM_VOICE_TONE"] != nil, let self {
                let frames = AVAudioFrameCount((Double(buffer.frameLength) * delivered.sampleRate / format.sampleRate).rounded())
                guard let made = AVAudioPCMBuffer(pcmFormat: delivered, frameCapacity: frames), let channels = made.floatChannelData else { return }
                made.frameLength = frames
                for frame in 0..<Int(frames) {
                    let value = Float(0.5 * sin(2 * Double.pi * 440 * (self.probeSeconds + Double(frame) / delivered.sampleRate)))
                    for channel in 0..<Int(delivered.channelCount) { channels[channel][frame] = value }
                }
                self.probeSeconds += Double(frames) / delivered.sampleRate
                buffer = made
            }
'''),
    ('''            guard again else { return end() }
''', '''            NSLog("MindRoom voice probe: the tap failed; %@", again ? "asking once more in 250 ms" : "the recording ends")
            guard again else { return end() }
'''),
    # FLOOD=<n>: n buffers of 0.1 s arrive at once during a pause.
    ('''    func pause() {
        paused = true
        engine.pause()
''', '''    static let probe = ProcessInfo.processInfo.environment
    var probeOther: AVAssetWriterInput?
    var probeTaps = 0
    var probeSeconds = 0.0
    func pause() {
        paused = true
        engine.pause()
        if let flood = Recording.probe["MINDROOM_VOICE_FLOOD"].flatMap({ Int($0) }) {
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.3) { [self] in
                let waiting = { self.shared.withLock { self.pending.count } }
                for _ in 0..<flood {
                    guard let buffer = AVAudioPCMBuffer(pcmFormat: Recording.format, frameCapacity: 1_600), let samples = buffer.floatChannelData?[0] else { return }
                    buffer.frameLength = 1_600
                    for frame in 0..<1_600 { samples[frame] = Float(0.5 * sin(2 * Double.pi * 440 * (probeSeconds + Double(frame) / 16_000))) }
                    probeSeconds += 0.1
                    take(buffer)
                }
                Thread.sleep(forTimeInterval: 0.2)
                NSLog("MindRoom voice probe: %d buffers at once while paused; waiting for the writer: %d, ready=%d", flood, waiting(), input.isReadyForMoreMediaData ? 1 : 0)
                Thread.sleep(forTimeInterval: 2)
                NSLog("MindRoom voice probe: 2 s later, still paused: waiting %d; the other input finishes now", waiting())
                probeOther?.markAsFinished()
                Thread.sleep(forTimeInterval: 0.5)
                NSLog("MindRoom voice probe: 0.5 s later, still paused: waiting %d", waiting())
            }
        }
'''),
    # HOLD=<s>: the writer takes that long to finish the file.
    ('''        input.markAsFinished()
        writer.finishWriting { [self] in done(whole && writer.status == .completed) }
''', '''        input.markAsFinished()
        let hold = Recording.probe["MINDROOM_VOICE_HOLD"].flatMap { Double($0) } ?? 0
        NSLog("MindRoom voice probe: the file is finished with whole=%d, at %.2f s", whole ? 1 : 0, CMTimeGetSeconds(written))
        queue.asyncAfter(deadline: .now() + hold) { [self] in
            writer.finishWriting { [self] in
                NSLog("MindRoom voice probe: the writer is done, status %d", writer.status.rawValue)
                done(whole && writer.status == .completed)
            }
        }
'''),
])

SCRIPT = r'''
const call = (method, options = {}) => window.Capacitor.nativePromise('MindRoomVoiceRecorder', method, options);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const say = (text) => call('probeLog', { text: `${mode}: ${text}` });
const code = (error) => error.code || error.message || String(error);
const read = async (path) => {
  const response = await fetch(window.Capacitor.convertFileSrc(path), { signal: AbortSignal.timeout(5000) });
  return !response.ok && response.status !== 0 ? 0 : (await response.blob()).size;
};
const listed = async (id) => (await call('orphans')).recordings.some((r) => r.id === id);
// As NativeVoiceRecorder.stop: the path, whether it is incomplete, and the bytes the page reads.
const stop = async (id) => {
  const asked = Date.now();
  try {
    const { path, incomplete } = await call('stop', { id });
    return `stop=ok after ${Date.now() - asked} ms incomplete=${incomplete} bytes=${await read(path)}`;
  } catch (error) {
    return `stop=${code(error)}`;
  }
};
// Asks for the level every 100 ms, as the page does; the slowest answer shows a blocked main queue.
const poll = (id) => {
  const seen = { slowest: 0, ended: '' };
  const timer = setInterval(async () => {
    const asked = Date.now();
    await call('level', { id }).catch((error) => { seen.ended ||= code(error); });
    seen.slowest = Math.max(seen.slowest, Date.now() - asked);
  }, 100);
  return { seen, end: () => clearInterval(timer) };
};
try {
  if (document.readyState !== 'complete') await new Promise((done) => addEventListener('load', done));
  await wait(500);
  if (mode === 'list') {
    const { recordings } = await call('orphans');
    return `orphans: [${recordings.map((r) => `${r.id} owner=${r.owner}`).join(', ')}]`;
  }
  if (mode.startsWith('forget:')) {
    const id = mode.slice(7);
    return `listedBefore=${await listed(id)} forget=${await call('forget', { id }).then(() => 'ok', code)} listedAfter=${await listed(id)}`;
  }
  const nonce = `${Date.now()}-${Math.random()}`;
  window.mindroomVoiceStart = nonce;
  const { id } = await call('start', { nonce, owner: '@probe:example.org' });
  await say(`started ${id}`);
  if (mode === 'kill') { await wait(600000); return 'not killed'; }
  if (mode === 'reload') { await wait(2000); return 'reloading'; }
  if (mode === 'stopreload') { await wait(2000); return `${await stop(id)}; reloading`; }
  if (mode === 'discard') {
    await wait(1500);
    return `forget=${await call('forget', { id }).then(() => 'ok', code)} listedAfter=${await listed(id)} stopAfter=${await stop(id)}`;
  }
  if (mode === 'invalid') {
    await call('forget', { id });
    const answers = [];
    for (const other of ['../../etc/passwd', 'not-a-uuid', '']) answers.push(`'${other}' -> ${await call('forget', { id: other }).then(() => 'ok', code)}`);
    return `forget ${answers.join(', ')}; an absent UUID -> ${await call('forget', { id: '00000000-0000-4000-8000-000000000000' }).then(() => 'ok', code)}`;
  }
  const levels = poll(id);
  // paused: 1.5 s, a pause of 2.5 s, 1.5 s. Else 6 s on end.
  if (mode === 'paused') {
    await wait(1500);
    levels.end();
    await call('pause', { id });
    await wait(2500);
    const resumed = await call('resume', { id }).then(() => 'ok', code);
    await wait(1500);
    return `resume=${resumed} ${await stop(id)} listedAfterStop=${await listed(id)}`;
  }
  // stopearly: the stop is asked 2.5 s in (while the writer hangs, or holds its finish).
  await wait(mode === 'stopearly' ? 2500 : 6000);
  levels.end();
  const live = await listed(id);
  const stopped = await stop(id);
  return `level: slowest answer ${levels.seen.slowest} ms, ended=${levels.seen.ended || 'no'}; listedBeforeStop=${live} ${stopped} listedAfterStop=${await listed(id)} secondStop: ${await stop(id)}`;
} catch (error) {
  return `failed ${code(error)}`;
}
'''

patch(root + "/ios/App/App/MindRoomBridgeViewController.swift", [
    ('''    override func viewDidAppear(_ animated: Bool) {
''', '''    private var didStartVoiceProbe = false
    override func viewDidAppear(_ animated: Bool) {
'''),
    ('''#if DEBUG
        guard ProcessInfo.processInfo.environment["MINDROOM_FILE_SAVE_ACCEPTANCE"] == "1",''', '''#if DEBUG && targetEnvironment(macCatalyst)
        if let probe = ProcessInfo.processInfo.environment["MINDROOM_VOICE_PROBE"], !didStartVoiceProbe {
            didStartVoiceProbe = true
            let script = """''' + SCRIPT.replace("\\", "\\\\").replace("\n", "\n            ") + '''
            """
            let run = { [weak self] (mode: String, then: @escaping () -> Void) in
                self?.webView?.callAsyncJavaScript(script, arguments: ["mode": mode], in: nil, in: .page) { result in
                    NSLog("MindRoom voice probe: %@ result %@", mode, String(describing: result))
                    then()
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                run(probe) { [weak self] in
                    guard probe == "reload" || probe == "stopreload" else { return }
                    self?.webView?.reload()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 6) { run("list") {} }
                }
            }
        }
#endif

#if DEBUG
        guard ProcessInfo.processInfo.environment["MINDROOM_FILE_SAVE_ACCEPTANCE"] == "1",'''),
])
print("patched")
