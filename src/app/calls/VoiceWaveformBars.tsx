import { useEffect, useRef } from 'react';
import { keepAudioContextRunning } from '../lib/speechModelAssets';
import {
  SPECTRUM_BAR_COUNT,
  barScaleFromLevel,
  extractSpectrumBands,
  stepSpectrumBars,
} from './audioSpectrum';
import * as css from './CallStage.css';

export type VoiceAudioSource = 'remote' | 'local' | 'none';
export type VoiceWaveformBarsProps = {
  track?: MediaStreamTrack;
  source: VoiceAudioSource;
  speaking: boolean;
};

type AudioEngine = {
  context: AudioContext;
  analyser: AnalyserNode;
  stopKeepingRunning: () => void;
  bins: Uint8Array<ArrayBuffer>;
  target: Float32Array;
  current: Float32Array;
};

const FFT_SIZE = 1024;
const DEFAULT_FRAME_DT_MS = 16;
const MAX_FRAME_DT_MS = 100;
const REDUCED_MOTION_INTERVAL_MS = 100;
const BAR_INDICES = Array.from({ length: SPECTRUM_BAR_COUNT }, (_, index) => index);

const createAudioEngine = (): AudioEngine | null => {
  const Ctor = globalThis.AudioContext;
  if (typeof Ctor !== 'function') return null;
  try {
    const context = new Ctor();
    const analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.minDecibels = -75;
    analyser.maxDecibels = -18;
    analyser.smoothingTimeConstant = 0.5;
    const stopKeepingRunning = keepAudioContextRunning(context);
    return {
      context,
      analyser,
      stopKeepingRunning,
      bins: new Uint8Array(analyser.frequencyBinCount || FFT_SIZE / 2),
      target: new Float32Array(SPECTRUM_BAR_COUNT),
      current: new Float32Array(SPECTRUM_BAR_COUNT),
    };
  } catch {
    return null;
  }
};

const clearBarTransforms = (bars: Array<HTMLSpanElement | null>) => {
  for (let i = 0; i < SPECTRUM_BAR_COUNT; i += 1) {
    const bar = bars[i];
    if (bar) bar.style.transform = '';
  }
};

const resetWaveformDom = (
  container: HTMLSpanElement | null,
  bars: Array<HTMLSpanElement | null>,
  engine: AudioEngine | null
) => {
  engine?.target.fill(0);
  engine?.current.fill(0);
  clearBarTransforms(bars);
  if (container) container.dataset.audioActive = 'false';
};

/**
 * Five-bar live FFT frequency-band EQ waveform for the voice call stage.
 * Updates bar transforms via DOM refs with zero React re-renders or per-frame allocations.
 */
export function VoiceWaveformBars({ track, source, speaking }: VoiceWaveformBarsProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const barRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const audioRef = useRef<AudioEngine | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const bars = barRefs.current;
    if (!track || track.readyState === 'ended' || typeof globalThis.MediaStream !== 'function') {
      resetWaveformDom(container, bars, audioRef.current);
      return undefined;
    }

    const reused = audioRef.current !== null;
    const engine = audioRef.current ?? createAudioEngine();
    if (!engine) {
      resetWaveformDom(container, bars, null);
      return undefined;
    }
    audioRef.current = engine;

    let sourceNode: MediaStreamAudioSourceNode | null = null;
    try {
      sourceNode = engine.context.createMediaStreamSource(new globalThis.MediaStream([track]));
      sourceNode.connect(engine.analyser);
    } catch {
      resetWaveformDom(container, bars, engine);
      return undefined;
    }

    let activeTrack = true;
    let frameId: number | null = null;
    let lastUpdateTime: number | undefined;

    const motionQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : undefined;
    let reducedMotion = motionQuery?.matches ?? false;
    if (reducedMotion) clearBarTransforms(bars);
    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      if (reducedMotion) clearBarTransforms(bars);
    };
    motionQuery?.addEventListener?.('change', onMotionChange);

    const stopLoop = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      lastUpdateTime = undefined;
    };

    const resumeIfNeeded = () => {
      if (engine.context.state !== 'running') {
        void Promise.resolve(engine.context.resume()).catch(() => undefined);
      }
    };
    if (reused) resumeIfNeeded();

    const tick = (now: number) => {
      frameId = null;
      if (!activeTrack || document.hidden) return;
      const elapsed = lastUpdateTime === undefined ? undefined : now - lastUpdateTime;
      if (reducedMotion && elapsed !== undefined && elapsed < REDUCED_MOTION_INTERVAL_MS) {
        frameId = requestAnimationFrame(tick);
        return;
      }
      const maxDt = reducedMotion ? REDUCED_MOTION_INTERVAL_MS * 2 : MAX_FRAME_DT_MS;
      const dtMs =
        elapsed === undefined
          ? reducedMotion
            ? REDUCED_MOTION_INTERVAL_MS
            : DEFAULT_FRAME_DT_MS
          : Math.max(0, Math.min(elapsed, maxDt));
      lastUpdateTime = now;

      engine.analyser.getByteFrequencyData(engine.bins);
      extractSpectrumBands(
        engine.bins,
        engine.context.sampleRate,
        engine.analyser.fftSize,
        engine.target
      );
      const audioActive = stepSpectrumBars(engine.target, engine.current, dtMs);

      if (!reducedMotion) {
        for (let i = 0; i < SPECTRUM_BAR_COUNT; i += 1) {
          const bar = bars[i];
          if (bar)
            bar.style.transform = `scaleY(${barScaleFromLevel(engine.current[i] ?? 0).toFixed(3)})`;
        }
      }
      if (container) container.dataset.audioActive = audioActive ? 'true' : 'false';
      frameId = requestAnimationFrame(tick);
    };

    const startLoop = () => {
      if (activeTrack && !document.hidden && frameId === null) {
        frameId = requestAnimationFrame(tick);
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        stopLoop();
      } else {
        resumeIfNeeded();
        startLoop();
      }
    };
    const teardownTrack = () => {
      activeTrack = false;
      stopLoop();
      if (sourceNode) {
        try {
          sourceNode.disconnect();
        } catch {
          // Already disconnected.
        }
        sourceNode = null;
      }
      resetWaveformDom(container, bars, engine);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    track.addEventListener('ended', teardownTrack);
    startLoop();

    return () => {
      teardownTrack();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      track.removeEventListener('ended', teardownTrack);
      motionQuery?.removeEventListener?.('change', onMotionChange);
    };
  }, [track]);

  useEffect(
    () => () => {
      const engine = audioRef.current;
      audioRef.current = null;
      if (engine) {
        engine.stopKeepingRunning();
        void Promise.resolve(engine.context.close()).catch(() => undefined);
      }
    },
    []
  );

  return (
    <span
      ref={containerRef}
      className={css.VoiceBars}
      data-call-voice-bars=""
      data-speaking={speaking}
      data-audio-source={source}
      data-audio-active="false"
      aria-hidden
    >
      {BAR_INDICES.map((index) => (
        <span
          key={index}
          ref={(node) => {
            barRefs.current[index] = node;
          }}
          className={css.VoiceBar}
          data-call-voice-bar={index}
        />
      ))}
    </span>
  );
}
