import type { Tensor } from 'onnxruntime-web/wasm';
import {
  SILERO_VAD_MODEL_FILE,
  configureSpeechOrt,
  getSpeechModelDirectory,
  loadSpeechRuntime,
} from '../../lib/speechModelAssets';
import { DICTATION_SAMPLE_RATE, type VadScorer } from './dictationSegmenter';

export type SileroVadInstance = VadScorer & {
  reset: () => void;
  release: () => Promise<void>;
};

const HIDDEN_DIMS = [2, 1, 64] as const;
const HIDDEN_SIZE = 128;

/**
 * Loads `silero_vad_legacy.onnx` using the shared speech ONNX runtime assets.
 * Dynamically imports `onnxruntime-web` so it never enters the initial bundle.
 */
export const loadSileroVad = async (signal?: AbortSignal): Promise<SileroVadInstance> => {
  const directory = getSpeechModelDirectory();
  const [ort, runtime, modelBytes] = await Promise.all([
    import('onnxruntime-web/wasm'),
    loadSpeechRuntime(directory),
    fetch(`${directory}${SILERO_VAD_MODEL_FILE}`, { signal }).then((response) => {
      if (!response.ok) throw new Error(`The VAD model answered ${response.status}.`);
      return response.arrayBuffer();
    }),
  ]);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  configureSpeechOrt(ort, runtime);
  const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] });
  if (signal?.aborted) {
    await session.release().catch(() => undefined);
    throw new DOMException('Aborted', 'AbortError');
  }

  const makeHidden = () =>
    new ort.Tensor('float32', new Float32Array(HIDDEN_SIZE), [...HIDDEN_DIMS]);
  const sr: Tensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(DICTATION_SAMPLE_RATE)]), [
    1,
  ]);
  let h: Tensor = makeHidden();
  let c: Tensor = makeHidden();
  let released = false;

  const reset = () => {
    if (released) return;
    h.dispose();
    c.dispose();
    h = makeHidden();
    c = makeHidden();
  };

  const score = async (frame: Float32Array): Promise<number> => {
    if (released) throw new Error('VAD session released.');
    const input = new ort.Tensor('float32', frame, [1, frame.length]);
    try {
      const outputs = await session.run({ input, h, c, sr });
      const nextH = outputs.hn;
      const nextC = outputs.cn;
      const out = outputs.output;
      if (!nextH || !nextC || !out) throw new Error('Silero VAD returned incomplete outputs.');
      h.dispose();
      c.dispose();
      h = nextH;
      c = nextC;
      const prob = Number(out.data[0] ?? 0);
      out.dispose();
      return prob;
    } finally {
      input.dispose();
    }
  };

  const release = async () => {
    if (released) return;
    released = true;
    h.dispose();
    c.dispose();
    sr.dispose();
    await session.release().catch(() => undefined);
  };

  return { score, reset, release };
};
