import { appUrl } from './basePath';

declare const __MINDROOM_SPEECH_MODEL__: string;

export const SILERO_VAD_MODEL_FILE = 'silero_vad_legacy.onnx';
export const DICTATION_WORKLET_FILE = 'dictationCaptureWorklet.js';

/** What a person does that lets a page start sound (browsers' autoplay rules). */
const USER_GESTURES = ['pointerdown', 'pointerup', 'click', 'keydown', 'touchend'] as const;

export type SpeechRuntimeAssets = {
  moduleUrl: string;
  wasm: ArrayBuffer;
};

type OrtLike = {
  env: {
    logLevel?: 'verbose' | 'info' | 'warning' | 'error' | 'fatal';
    wasm: {
      numThreads?: number;
      wasmPaths?: unknown;
      wasmBinary?: unknown;
    };
  };
};

/**
 * Loads of the runtime's module that failed in this page. The runtime keeps a start that failed
 * failed for good, so callers load its module and WebAssembly before starting; the browser keeps
 * a module that failed to load failed too, so each load after such a failure asks for the module
 * by a URL of its own.
 */
let failedModuleLoads = 0;

/**
 * The build's directory of the speech AudioWorklets, the Silero VAD model and the ONNX runtime
 * WebAssembly (`vite.config.js` names it); unit tests run without the build's constants.
 */
export const getSpeechModelDirectory = (): string =>
  `${appUrl(
    typeof __MINDROOM_SPEECH_MODEL__ === 'string'
      ? __MINDROOM_SPEECH_MODEL__
      : 'assets/speech-model'
  )}/`;

/** Loads the ONNX runtime's JS glue module and its WebAssembly binary from `directory`. */
export const loadSpeechRuntime = async (
  directory = getSpeechModelDirectory()
): Promise<SpeechRuntimeAssets> => {
  const moduleUrl = `${directory}ort-wasm-simd-threaded.js${
    failedModuleLoads ? `?retry=${failedModuleLoads}` : ''
  }`;
  const [wasm] = await Promise.all([
    fetch(`${directory}ort-wasm-simd-threaded.wasm`).then((response) => {
      if (!response.ok) throw new Error(`The speech runtime answered ${response.status}.`);
      return response.arrayBuffer();
    }),
    import(/* @vite-ignore */ moduleUrl).catch((error: unknown) => {
      failedModuleLoads += 1;
      throw error;
    }),
  ]);
  return { moduleUrl, wasm };
};

/**
 * Configures onnxruntime-web with preloaded WASM assets and forces single-threaded execution when
 * `crossOriginIsolated` is false (critical for Safari and WKWebView).
 */
export const configureSpeechOrt = (ort: OrtLike, runtime: SpeechRuntimeAssets): void => {
  const { env } = ort;
  env.logLevel = 'error';
  if (typeof self !== 'undefined' && !self.crossOriginIsolated) {
    env.wasm.numThreads = 1;
  }
  env.wasm.wasmPaths = { mjs: runtime.moduleUrl };
  env.wasm.wasmBinary = runtime.wasm;
};

/**
 * Keeps an AudioContext running across autoplay suspension and mobile interruptions.
 * Returns a disposer that clears `onstatechange` and removes the gesture listeners.
 */
export const keepAudioContextRunning = (context: AudioContext): (() => void) => {
  const keepRunning = () => {
    if (context.state !== 'running') context.resume().catch(() => undefined);
  };
  keepRunning();
  context.onstatechange = keepRunning;
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    USER_GESTURES.forEach((type) => window.addEventListener(type, keepRunning, { capture: true }));
  }
  return () => {
    context.onstatechange = null;
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      USER_GESTURES.forEach((type) =>
        window.removeEventListener(type, keepRunning, { capture: true })
      );
    }
  };
};
