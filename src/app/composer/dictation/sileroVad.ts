import type { InferenceSession, Tensor } from 'onnxruntime-web/wasm';
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

type OrtModule = typeof import('onnxruntime-web/wasm');

type CachedSileroRuntime = {
  ort: OrtModule;
  session: InferenceSession;
  sr: Tensor;
  runQueue: Promise<unknown>;
};

// Shared across dictation sessions so starting a second dictation does not re-fetch or re-compile
// the 16 MB ONNX WASM runtime and Silero weights. Cleared on load failure so future starts retry.
let cachedRuntimePromise: Promise<CachedSileroRuntime> | undefined;

const loadCachedSileroRuntime = (): Promise<CachedSileroRuntime> => {
  if (cachedRuntimePromise) return cachedRuntimePromise;
  const directory = getSpeechModelDirectory();
  cachedRuntimePromise = (async () => {
    const [ort, runtime, modelBytes] = await Promise.all([
      import('onnxruntime-web/wasm'),
      loadSpeechRuntime(directory),
      fetch(`${directory}${SILERO_VAD_MODEL_FILE}`).then((response) => {
        if (!response.ok) throw new Error(`The VAD model answered ${response.status}.`);
        return response.arrayBuffer();
      }),
    ]);
    configureSpeechOrt(ort, runtime);
    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ['wasm'],
    });
    const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(DICTATION_SAMPLE_RATE)]), [1]);
    return { ort, session, sr, runQueue: Promise.resolve() };
  })().catch((error: unknown) => {
    cachedRuntimePromise = undefined;
    throw error;
  });
  return cachedRuntimePromise;
};

const awaitWithAbort = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
};

/**
 * Returns a Silero VAD scorer backed by the cached ONNX InferenceSession, with fresh per-session
 * RNN hidden state (`h`, `c`). Dynamically imports `onnxruntime-web/wasm` on first use.
 */
export const loadSileroVad = async (signal?: AbortSignal): Promise<SileroVadInstance> => {
  const runtime = await awaitWithAbort(loadCachedSileroRuntime(), signal);
  const { ort, session, sr } = runtime;

  const makeHidden = () =>
    new ort.Tensor('float32', new Float32Array(HIDDEN_SIZE), [...HIDDEN_DIMS]);
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

  const score = (frame: Float32Array): Promise<number> => {
    const task = runtime.runQueue
      .catch(() => undefined)
      .then(async () => {
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
      });
    runtime.runQueue = task.catch(() => undefined);
    return task;
  };

  const release = async () => {
    if (released) return;
    released = true;
    // Wait for any in-flight run using h/c before disposing them; keep the shared session cached.
    await runtime.runQueue.catch(() => undefined);
    h.dispose();
    c.dispose();
  };

  return { score, reset, release };
};
