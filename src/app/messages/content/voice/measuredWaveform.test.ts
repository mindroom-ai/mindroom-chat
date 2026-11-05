import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFlatWaveform, useMeasuredWaveform, waveformFromChannels } from './measuredWaveform';

const tone = (length: number, amplitude: number): Float32Array =>
  Float32Array.from({ length }, (_value, index) => amplitude * Math.sin(index / 3));

describe('measured voice waveforms', () => {
  it('treats a missing, empty, or constant waveform as flat', () => {
    expect(isFlatWaveform(undefined)).toBe(true);
    expect(isFlatWaveform([])).toBe(true);
    expect(isFlatWaveform([512])).toBe(true);
    expect(isFlatWaveform(Array<number>(30).fill(512))).toBe(true);
    expect(isFlatWaveform(Array<number>(30).fill(0))).toBe(true);
  });

  it('keeps a waveform with any variation', () => {
    expect(isFlatWaveform([512, 512, 511])).toBe(false);
    expect(isFlatWaveform([0, 1024])).toBe(false);
  });

  it('scales each bar to its RMS level, the loudest bar at the maximum', () => {
    const loud = tone(400, 0.8);
    const quiet = tone(400, 0.2);
    const silent = new Float32Array(400);
    const channel = new Float32Array(1200);
    channel.set(loud, 0);
    channel.set(quiet, 400);
    channel.set(silent, 800);

    const waveform = waveformFromChannels([channel], 3);

    expect(waveform).toHaveLength(3);
    expect(waveform?.[0]).toBe(1024);
    expect(waveform?.[1]).toBeGreaterThan(230);
    expect(waveform?.[1]).toBeLessThan(282);
    expect(waveform?.[2]).toBe(0);
  });

  it('measures every channel and spreads uneven lengths over the bars', () => {
    const left = new Float32Array(100).fill(0.5);
    const right = new Float32Array(100);
    right.fill(0.5, 0, 50);

    const waveform = waveformFromChannels([left, right], 7);

    expect(waveform).toHaveLength(7);
    expect(waveform?.[0]).toBe(1024);
    expect(waveform?.[6]).toBe(Math.round(1024 / Math.SQRT2));
  });

  it('gives silence a zero waveform and too-short audio none', () => {
    expect(waveformFromChannels([new Float32Array(96)], 48)).toEqual(Array<number>(48).fill(0));
    expect(waveformFromChannels([new Float32Array(47)], 48)).toBeUndefined();
    expect(waveformFromChannels([], 48)).toBeUndefined();
  });
});

type ProbeProps = {
  identity: string;
  src?: string;
  waveform?: number[];
  onShow: (waveform: number[]) => void;
};

function Probe({ identity, src, waveform, onShow }: ProbeProps) {
  onShow(useMeasuredWaveform(identity, src, waveform));
  return null;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('useMeasuredWaveform', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a real waveform as sent', () => {
    let shown: number[] | undefined;
    const renderer = create(
      React.createElement(Probe, {
        identity: 'real',
        waveform: [0, 512, 1024],
        onShow: (waveform) => {
          shown = waveform;
        },
      })
    );
    expect(shown).toEqual([0, 512, 1024]);
    act(() => renderer.unmount());
  });

  it('measures a flat waveform from loaded audio and keeps it for the event', async () => {
    const channel = new Float32Array(96);
    channel.fill(0.5, 0, 48);
    const decodeAudioData = vi.fn(() =>
      Promise.resolve({ numberOfChannels: 1, getChannelData: () => channel })
    );
    const fetchAudio = vi.fn(() =>
      Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })
    );
    vi.stubGlobal(
      'OfflineAudioContext',
      class {
        decodeAudioData = decodeAudioData;
      }
    );
    vi.stubGlobal('fetch', fetchAudio);
    let shown: number[] | undefined;
    const probe = (src?: string) =>
      React.createElement(Probe, {
        identity: 'flat',
        src,
        waveform: Array<number>(30).fill(512),
        onShow: (waveform) => {
          shown = waveform;
        },
      });
    const measured = [...Array<number>(24).fill(1024), ...Array<number>(24).fill(0)];

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(probe());
      await settle();
    });
    expect(shown).toEqual(Array<number>(48).fill(0));
    expect(fetchAudio).not.toHaveBeenCalled();

    await act(async () => {
      renderer?.update(probe('blob:voice'));
      await settle();
    });
    expect(fetchAudio).toHaveBeenCalledWith('blob:voice');
    expect(shown).toEqual(measured);
    act(() => renderer?.unmount());

    // The event drawn again, before its audio loads, keeps the measured waveform.
    await act(async () => {
      renderer = create(probe());
      await settle();
    });
    expect(shown).toEqual(measured);
    expect(fetchAudio).toHaveBeenCalledTimes(1);
    act(() => renderer?.unmount());
  });
});
