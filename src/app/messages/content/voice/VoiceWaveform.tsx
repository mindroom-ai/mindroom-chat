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

// Sizes in SVG user units. The compact waveform is toRem(32) tall and as wide as its viewBox
// makes it, so a unit is one px at the default root font size, scaled with page zoom.
const SVG_HEIGHT = 32;
const BAR_WIDTH = 2;
const BAR_GAP = 1;
// One bar and its gap: how far the bars move per new sample, and the dotted line's repeat.
const BAR_STEP = BAR_WIDTH + BAR_GAP;
// The farthest a live glide starts from rest, in bar steps. More samples at once jump the rest
// of the way.
const GLIDE_MAX_STEPS = 2;
// The compact svg is this many bar steps wide, wider than any waveform, whatever the number of
// bars: its box then never moves, so neither does the pixel its origin is snapped to (see
// useLiveGlide). The bars sit at its right end and the dotted line fills the rest.
const COMPACT_VIEW_STEPS = 2048;
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

const renderBars = (
  bars: number[],
  compact: boolean | undefined,
  getClassName: (index: number) => string,
  firstStep = 0
) =>
  bars.map((point, index) => {
    const height = getBarHeight(point, compact);
    return (
      <rect
        // eslint-disable-next-line react/no-array-index-key
        key={index}
        className={getClassName(index)}
        x={(firstStep + index) * BAR_STEP}
        y={(SVG_HEIGHT - height) / 2}
        width={BAR_WIDTH}
        height={height}
        rx="1"
      />
    );
  });

type Glide = { fromSteps: number; startTime: number; frame: number };

// The time of the frame on screen, which requestAnimationFrame's timestamps count in too.
const getFrameTime = (doc: Document): number => {
  const time = doc.timeline?.currentTime;
  return typeof time === 'number' ? time : performance.now();
};

// How far the bars still are from rest at a frame time, in bar steps.
const getGlideSteps = (glide: Glide, time: number): number =>
  glide.fromSteps *
  (1 - clampProgress((time - glide.startTime) / VOICE_WAVEFORM_SAMPLE_INTERVAL_MS));

// Each new sample moves the bars a step left. Rather than jump, the bars start that far to the
// right and glide back over one sample interval, from wherever a glide still running left them.
// The glide moves the bars inside the svg, by a transform attribute on their group written every
// animation frame. Moving a box instead, as the strip's end inset did, is snapped to whole device
// pixels by Chrome and WebKit, so at a non-integer pixel ratio (browser zoom, display scaling)
// the bars moved 1, 1, 1, then 2 pixels a frame, and with crisp edges each bar's edges rounded
// on their own, so bars and gaps changed width as they went. Inside the svg, whose box stays put
// (COMPACT_VIEW_STEPS), the bars move by fractions of a pixel, antialiased. Nor is the group a
// CSS transform animation: browsers may give that its own compositor layer as wide as every bar
// recorded so far, and iOS WebKit drew such a layer blank for whole glides at some widths (#416).
const useLiveGlide = (barsRef: RefObject<SVGGElement>, sampleCount: number | undefined) => {
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
    if (running) cancelAnimationFrame(running.frame);

    const bars = barsRef.current;
    if (!bars) return;
    const startTime = getFrameTime(bars.ownerDocument);
    if (added <= 0 || typeof requestAnimationFrame !== 'function' || prefersReducedMotion()) {
      bars.removeAttribute('transform');
      return;
    }
    const glide: Glide = {
      fromSteps: Math.min(
        GLIDE_MAX_STEPS,
        added + (running ? getGlideSteps(running, startTime) : 0)
      ),
      startTime,
      frame: 0,
    };
    const draw = (time: number) => {
      const steps = getGlideSteps(glide, time);
      if (steps <= 0) {
        bars.removeAttribute('transform');
        if (glideRef.current === glide) glideRef.current = undefined;
        return;
      }
      bars.setAttribute('transform', `translate(${steps * BAR_STEP} 0)`);
      glide.frame = requestAnimationFrame(draw);
    };
    glideRef.current = glide;
    // Place the bars for the frame on screen now, since this render just moved them left.
    draw(startTime);
  }, [sampleCount, barsRef]);

  useLayoutEffect(
    () => () => {
      if (glideRef.current) cancelAnimationFrame(glideRef.current.frame);
    },
    []
  );
};

// Media reports its time only a few times a second, so a fill drawn from those reports moves in
// visible jumps. While playing, redraw the fill's width from the media every animation frame
// instead. Each render first writes the fill from the last report, so `progress` is a dependency:
// the effect then redraws from the media before the frame is painted.
const usePlayedFill = (
  fillRef: RefObject<SVGSVGElement>,
  fullWidth: number,
  progress: number,
  getProgress: (() => number) | undefined
) => {
  useLayoutEffect(() => {
    const fill = fillRef.current;
    if (!fill || !getProgress) return undefined;
    let frame = 0;
    const draw = () => {
      fill.setAttribute('width', String(clampProgress(getProgress()) * fullWidth));
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [fillRef, fullWidth, progress, getProgress]);
};

type VoiceWaveformProps = {
  waveform?: number[];
  progress?: number;
  dimmed?: boolean;
  compact?: boolean;
  /** Compact only: the live recording's sample count, whose growth glides the bars left. */
  liveSampleCount?: number;
  /** While playing: reads the played share, so the fill follows every frame (see usePlayedFill). */
  getProgress?: () => number;
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
  getProgress,
  label,
  valueText,
  disabled,
  onSeekProgress,
}: VoiceWaveformProps) {
  const { t } = useTranslation();
  const glideRef = useRef<SVGGElement>(null);
  useLiveGlide(glideRef, compact ? liveSampleCount : undefined);
  const bars = compact ? normalizeRecordingWaveform(waveform) : normalizeMatrixWaveform(waveform);
  const compactUnrecordedBarCount = compact ? getCompactUnrecordedBarCount(waveform) : 0;
  const svgWidth = getSvgWidth(
    compact ? COMPACT_VIEW_STEPS : bars.length || VOICE_WAVEFORM_BAR_COUNT
  );
  const compactFirstStep = COMPACT_VIEW_STEPS - bars.length;
  const normalizedProgress = clampProgress(progress);
  const fillRef = useRef<SVGSVGElement>(null);
  usePlayedFill(fillRef, svgWidth, normalizedProgress, compact ? undefined : getProgress);

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

  const baseBars = renderBars(
    bars,
    compact,
    (index) =>
      classNames(
        css.Bar,
        compact && css.BarCompact,
        compact && index < compactUnrecordedBarCount && css.BarCompactUnrecorded
      ),
    compact ? compactFirstStep : 0
  );
  const svg = (
    <svg
      className={classNames(css.Svg, compact && css.SvgCompact)}
      viewBox={`0 0 ${svgWidth} ${SVG_HEIGHT}`}
      {...(compact
        ? {
            width: svgWidth,
            height: SVG_HEIGHT,
            preserveAspectRatio: 'none',
          }
        : {
            preserveAspectRatio: 'none',
          })}
      aria-hidden="true"
      focusable="false"
    >
      {compact ? (
        // The bars and the dotted line before them, whose dots fall at the bars' step, glide
        // left together (useLiveGlide).
        <g ref={glideRef}>
          <line
            className={css.CompactLine}
            x1={0}
            x2={Math.max(0, compactFirstStep) * BAR_STEP}
            y1={SVG_HEIGHT / 2}
            y2={SVG_HEIGHT / 2}
            strokeWidth={3}
            strokeDasharray={`${BAR_WIDTH} ${BAR_GAP}`}
          />
          {baseBars}
        </g>
      ) : (
        baseBars
      )}
      {/* The played part: the same bars in the active color, cut off at the playback position
          by this nested svg's viewport, so the fill moves by pixels rather than whole bars. */}
      {compact ? null : (
        <svg ref={fillRef} width={normalizedProgress * svgWidth} height={SVG_HEIGHT}>
          {renderBars(bars, compact, () => css.BarActive)}
        </svg>
      )}
    </svg>
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
        {svg}
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
      {svg}
    </div>
  );
}
