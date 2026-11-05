import { useEffect, useState } from 'react';
import { VOICE_WAVEFORM_BAR_COUNT, VOICE_WAVEFORM_MAX } from '../../utils/audioWaveform';

// The bars need only the loudness envelope, so the audio is decoded at a low rate.
const DECODE_SAMPLE_RATE = 8000;

// Waveforms measured from loaded audio, by media identity, for the rest of the session.
const measuredWaveforms = new Map<string, number[]>();

// Until the audio is measured, the lowest bars: a quiet dotted line, not a made-up shape.
const PLACEHOLDER_WAVEFORM = Array<number>(VOICE_WAVEFORM_BAR_COUNT).fill(0);

/** Whether a Matrix waveform has no shape to draw: missing, empty, or every point equal. */
export const isFlatWaveform = (waveform: readonly number[] | undefined): boolean =>
  !waveform || waveform.every((point) => point === waveform[0]);

/** Each bar's RMS level over all channels, scaled so the loudest bar is the Matrix maximum. */
export const waveformFromChannels = (
  channels: readonly Float32Array[],
  barCount = VOICE_WAVEFORM_BAR_COUNT
): number[] | undefined => {
  const length = channels[0]?.length ?? 0;
  if (length < barCount) return undefined;

  const levels = Array.from({ length: barCount }, (_value, bar) => {
    const start = Math.floor((bar * length) / barCount);
    const end = Math.floor(((bar + 1) * length) / barCount);
    let squares = 0;
    channels.forEach((channel) => {
      for (let index = start; index < end; index += 1) squares += (channel[index] ?? 0) ** 2;
    });
    return Math.sqrt(squares / ((end - start) * channels.length));
  });
  const loudest = Math.max(...levels);
  return levels.map((level) =>
    loudest > 0 ? Math.round((level / loudest) * VOICE_WAVEFORM_MAX) : 0
  );
};

const measureWaveform = async (src: string): Promise<number[] | undefined> => {
  // An offline context decodes without opening an audio output.
  if (typeof OfflineAudioContext === 'undefined') return undefined;
  const data = await (await fetch(src)).arrayBuffer();
  const context = new OfflineAudioContext({
    numberOfChannels: 1,
    length: 1,
    sampleRate: DECODE_SAMPLE_RATE,
  });
  const buffer = await context.decodeAudioData(data);
  return waveformFromChannels(
    Array.from({ length: buffer.numberOfChannels }, (_value, channel) =>
      buffer.getChannelData(channel)
    )
  );
};

/**
 * The waveform to draw for an audio event. A flat or missing one shows a placeholder until the
 * player has loaded the audio (`src`), then the audio's own levels; this downloads nothing itself.
 */
export const useMeasuredWaveform = (
  identity: string,
  src: string | undefined,
  waveform: number[] | undefined
): number[] => {
  const flat = isFlatWaveform(waveform);
  // Set when a measurement lands, so the component renders it.
  const [, setMeasuredIdentity] = useState<string>();

  useEffect(() => {
    if (!flat || !src || measuredWaveforms.has(identity)) return undefined;
    let current = true;
    measureWaveform(src)
      .then((measured) => {
        if (!measured) return;
        measuredWaveforms.set(identity, measured);
        if (current) setMeasuredIdentity(identity);
      })
      // Audio the browser cannot decode keeps the placeholder.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [flat, identity, src]);

  if (waveform && !flat) return waveform;
  return measuredWaveforms.get(identity) ?? PLACEHOLDER_WAVEFORM;
};
