/* global sampleRate */

const TARGET_RATE = 16000;
const FRAME_SAMPLES = 1536;

class DictationCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.out = new Float32Array(FRAME_SAMPLES);
    this.outIndex = 0;
    this.acc = 0;
    this.accCount = 0;
    this.srcPos = 0;
    this.nextEmit = this.ratio;
    this.stopped = false;
    this.port.onmessage = (event) => {
      if (event.data === 'stop') {
        if (this.outIndex > 0) {
          const tail = this.out;
          this.out = new Float32Array(FRAME_SAMPLES);
          this.outIndex = 0;
          this.port.postMessage(tail, [tail.buffer]);
        }
        this.stopped = true;
      }
    };
  }

  process(inputs) {
    if (this.stopped) return false;
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const ch0 = channels[0];
    const chCount = channels.length;
    for (let i = 0; i < ch0.length; i += 1) {
      let sample = ch0[i];
      if (chCount > 1) {
        for (let c = 1; c < chCount; c += 1) sample += channels[c][i];
        sample /= chCount;
      }
      this.acc += sample;
      this.accCount += 1;
      this.srcPos += 1;
      if (this.srcPos >= this.nextEmit) {
        const value = this.acc / this.accCount;
        this.acc = 0;
        this.accCount = 0;
        while (this.srcPos >= this.nextEmit) {
          this.out[this.outIndex] = value;
          this.outIndex += 1;
          this.nextEmit += this.ratio;
          if (this.outIndex === FRAME_SAMPLES) {
            const frame = this.out;
            this.port.postMessage(frame, [frame.buffer]);
            this.out = new Float32Array(FRAME_SAMPLES);
            this.outIndex = 0;
            this.nextEmit -= this.srcPos;
            this.srcPos = 0;
          }
        }
      }
    }
    return true;
  }
}

registerProcessor('dictation-capture-processor', DictationCaptureProcessor);
