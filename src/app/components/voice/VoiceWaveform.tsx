import React, { KeyboardEventHandler, MouseEventHandler } from 'react';
import classNames from 'classnames';
import {
  clampWaveformPoint,
  createFallbackWaveform,
  VOICE_WAVEFORM_BAR_COUNT,
  VOICE_WAVEFORM_MAX,
  normalizeMatrixWaveform,
} from '../../utils/audioWaveform';
import * as css from './VoiceWaveform.css';

const SVG_HEIGHT = 32;
const BAR_WIDTH = 2;
const BAR_GAP = 1;
const RECORDING_WAVEFORM_SPEECH_BOOST_START = 0.12;
const RECORDING_WAVEFORM_SPEECH_BOOST = 0.9;
const getSvgWidth = (barCount: number): number =>
  Math.max(BAR_WIDTH, barCount * (BAR_WIDTH + BAR_GAP) - BAR_GAP);

const clampProgress = (value: number): number => Math.min(1, Math.max(0, value));

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

type VoiceWaveformProps = {
  waveform?: number[];
  progress?: number;
  dimmed?: boolean;
  compact?: boolean;
  label?: string;
  onSeekProgress?: (progress: number) => void;
};

export function VoiceWaveform({
  waveform,
  progress = 0,
  dimmed,
  compact,
  label,
  onSeekProgress,
}: VoiceWaveformProps) {
  const bars = compact ? normalizeRecordingWaveform(waveform) : normalizeMatrixWaveform(waveform);
  const compactUnrecordedBarCount = compact ? getCompactUnrecordedBarCount(waveform) : 0;
  const svgWidth = getSvgWidth(bars.length || VOICE_WAVEFORM_BAR_COUNT);
  const normalizedProgress = clampProgress(progress);
  const activeBars = Math.round(normalizedProgress * bars.length);

  const seekFromClientX = (currentTarget: HTMLElement, clientX: number) => {
    const rect = currentTarget.getBoundingClientRect();
    const width = rect.width || 1;
    onSeekProgress?.(clampProgress((clientX - rect.left) / width));
  };

  const handleClick: MouseEventHandler<HTMLElement> = (event) => {
    seekFromClientX(event.currentTarget, event.clientX);
  };

  const handleKeyDown: KeyboardEventHandler<HTMLElement> = (event) => {
    if (!onSeekProgress) return;

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

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      onSeekProgress(
        clampProgress(normalizedProgress + (event.key === 'ArrowRight' ? 0.05 : -0.05))
      );
    }
  };

  const content = (
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

  if (onSeekProgress) {
    return (
      <button
        className={classNames(
          css.Waveform,
          compact && css.WaveformCompact,
          css.WaveformSeek,
          dimmed && css.WaveformDimmed
        )}
        type="button"
        aria-label={label ?? 'Seek voice message'}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        {content}
      </button>
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
