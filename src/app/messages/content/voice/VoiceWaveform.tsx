import { useTranslation } from 'react-i18next';
import { KeyboardEventHandler, RefObject, useLayoutEffect, useRef } from 'react';
import classNames from 'classnames';
import {
  clampWaveformPoint,
  createFallbackWaveform,
  VOICE_WAVEFORM_BAR_COUNT,
  VOICE_WAVEFORM_MAX,
  VOICE_WAVEFORM_SAMPLE_INTERVAL_MS,
  normalizeMatrixWaveform,
} from '../../../lib/audioWaveform';
import * as css from './VoiceWaveform.css';
import { BAR_GAP, BAR_STEP, BAR_WIDTH, GLIDE_MAX_STEPS } from './waveformGeometry';

const SVG_HEIGHT = 32;
const RECORDING_WAVEFORM_SPEECH_BOOST_START = 0.12;
const RECORDING_WAVEFORM_SPEECH_BOOST = 0.9;
const getSvgWidth = (barCount: number): number =>
  Math.max(BAR_WIDTH, barCount * (BAR_WIDTH + BAR_GAP) - BAR_GAP);

const clampProgress = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

const normalizeRecordingWaveform = (waveform: number[] | undefined): number[] => {
  if (!Array.isArray(waveform) || waveform.length === 0) return createFallbackWaveform();

  const bars = waveform.map(clampWaveformPoint);
  if (bars.length >= VOICE_WAVEFORM_BAR_COUNT) return bars;

  return [...Array<number>(VOICE_WAVEFORM_BAR_COUNT - bars.length).fill(0), ...bars];
};

const getCompactUnrecordedBarCount = (waveform: number[] | undefined): number => {
  if (!Array.isArray(waveform) || waveform.length === 0) return 0;
  return Math.max(0, VOICE_WAVEFORM_BAR_COUNT - waveform.length);
};

const getBarHeight = (point: number, compact?: boolean): number => {
  const normalizedPoint = point / VOICE_WAVEFORM_MAX;
  const speechProgress = compact
    ? clampProgress(
        (normalizedPoint - RECORDING_WAVEFORM_SPEECH_BOOST_START) /
          (1 - RECORDING_WAVEFORM_SPEECH_BOOST_START)
      )
    : 0;
  const speechBoost =
    normalizedPoint * (1 - normalizedPoint) * RECORDING_WAVEFORM_SPEECH_BOOST * speechProgress;
  const scaledPoint = normalizedPoint + speechBoost;

  return Math.max(3, Math.min(SVG_HEIGHT, scaledPoint * SVG_HEIGHT));
};

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Glide = { animation: Animation; fromSteps: number };

// Each new sample moves the bars a step left. Rather than jump, the strip starts that far to
// the right and glides back over one sample interval, from wherever a glide still running left it.
const useLiveGlide = (stripRef: RefObject<HTMLDivElement>, sampleCount: number | undefined) => {
  const lastCountRef = useRef(sampleCount);
  const glideRef = useRef<Glide>();

  useLayoutEffect(() => {
    const added =
      sampleCount !== undefined && lastCountRef.current !== undefined
        ? sampleCount - lastCountRef.current
        : 0;
    lastCountRef.current = sampleCount;
    const running = glideRef.current;
    glideRef.current = undefined;
    const progress = running?.animation.effect?.getComputedTiming().progress;
    running?.animation.cancel();

    const strip = stripRef.current;
    if (added <= 0 || !strip || typeof strip.animate !== 'function' || prefersReducedMotion()) {
      return;
    }
    const fromSteps = Math.min(
      GLIDE_MAX_STEPS,
      added + (running && typeof progress === 'number' ? running.fromSteps * (1 - progress) : 0)
    );
    const animation = strip.animate(
      [{ transform: `translateX(${fromSteps * BAR_STEP}px)` }, { transform: 'none' }],
      { duration: VOICE_WAVEFORM_SAMPLE_INTERVAL_MS, easing: 'linear' }
    );
    // Start at the frame on screen rather than the next one, which would hold the bars still
    // for a frame on every sample.
    const frameTime = strip.ownerDocument.timeline?.currentTime;
    if (frameTime !== undefined && frameTime !== null) animation.startTime = frameTime;
    glideRef.current = { fromSteps, animation };
  }, [sampleCount, stripRef]);
};

type VoiceWaveformProps = {
  waveform?: number[];
  progress?: number;
  dimmed?: boolean;
  compact?: boolean;
  /** Compact only: the live recording's sample count, whose growth glides the bars left. */
  liveSampleCount?: number;
  label?: string;
  valueText?: string;
  disabled?: boolean;
  onSeekProgress?: (progress: number) => void;
};

export function VoiceWaveform({
  waveform,
  progress = 0,
  dimmed,
  compact,
  liveSampleCount,
  label,
  valueText,
  disabled,
  onSeekProgress,
}: VoiceWaveformProps) {
  const { t } = useTranslation();
  const stripRef = useRef<HTMLDivElement>(null);
  useLiveGlide(stripRef, compact ? liveSampleCount : undefined);
  const bars = compact ? normalizeRecordingWaveform(waveform) : normalizeMatrixWaveform(waveform);
  const compactUnrecordedBarCount = compact ? getCompactUnrecordedBarCount(waveform) : 0;
  const svgWidth = getSvgWidth(bars.length || VOICE_WAVEFORM_BAR_COUNT);
  const normalizedProgress = clampProgress(progress);
  const activeBars = Math.round(normalizedProgress * bars.length);

  const handleKeyDown: KeyboardEventHandler<HTMLElement> = (event) => {
    if (!onSeekProgress || disabled) return;

    if (event.key === 'Home') {
      event.preventDefault();
      onSeekProgress(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      onSeekProgress(1);
      return;
    }

    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      onSeekProgress(
        clampProgress(
          normalizedProgress + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 0.05 : -0.05)
        )
      );
    }
  };

  const svg = (
    <svg
      className={classNames(css.Svg, compact && css.SvgCompact)}
      viewBox={`0 0 ${svgWidth} ${SVG_HEIGHT}`}
      {...(compact
        ? {
            width: svgWidth,
            height: SVG_HEIGHT,
            preserveAspectRatio: 'none',
            shapeRendering: 'crispEdges',
          }
        : {
            preserveAspectRatio: 'none',
          })}
      aria-hidden="true"
      focusable="false"
    >
      {bars.map((point, index) => {
        const height = getBarHeight(point, compact);
        const y = (SVG_HEIGHT - height) / 2;

        return (
          <rect
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            className={classNames(
              index < activeBars ? css.BarActive : css.Bar,
              compact && css.BarCompact,
              compact && index < compactUnrecordedBarCount && css.BarCompactUnrecorded
            )}
            x={index * (BAR_WIDTH + BAR_GAP)}
            y={y}
            width={BAR_WIDTH}
            height={height}
            rx="1"
          />
        );
      })}
    </svg>
  );
  const content = compact ? (
    <div ref={stripRef} className={css.CompactStrip}>
      {svg}
    </div>
  ) : (
    svg
  );

  if (onSeekProgress) {
    return (
      <div
        className={classNames(
          css.Waveform,
          compact && css.WaveformCompact,
          css.WaveformSeek,
          dimmed && css.WaveformDimmed
        )}
      >
        {content}
        <input
          className={css.SeekInput}
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={normalizedProgress * 100}
          disabled={disabled}
          aria-label={label ?? t('sharedUi.voiceWaveform.seekVoiceMessage')}
          aria-valuetext={valueText ?? `${Math.round(normalizedProgress * 100)}%`}
          onChange={(event) =>
            onSeekProgress(clampProgress(Number(event.currentTarget.value) / 100))
          }
          onKeyDown={handleKeyDown}
        />
      </div>
    );
  }

  return (
    <div
      className={classNames(
        css.Waveform,
        compact && css.WaveformCompact,
        dimmed && css.WaveformDimmed
      )}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    >
      {content}
    </div>
  );
}
