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
const getSvgWidth = (barCount: number): number =>
  Math.max(BAR_WIDTH, barCount * (BAR_WIDTH + BAR_GAP) - BAR_GAP);

const clampProgress = (value: number): number => Math.min(1, Math.max(0, value));

const normalizeRecordingWaveform = (waveform: number[] | undefined): number[] => {
  if (!Array.isArray(waveform) || waveform.length === 0) return createFallbackWaveform();

  return waveform.map(clampWaveformPoint);
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
          }
        : {
            preserveAspectRatio: 'none',
          })}
      aria-hidden="true"
      focusable="false"
    >
      {bars.map((point, index) => {
        const height = Math.max(3, (point / VOICE_WAVEFORM_MAX) * SVG_HEIGHT);
        const y = (SVG_HEIGHT - height) / 2;

        return (
          <rect
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            className={index < activeBars ? css.BarActive : css.Bar}
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
