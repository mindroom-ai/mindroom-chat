// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeepTraceData, DeepTraceRuntimeStatus } from './deepTrace';
import {
  MEMORY_SAMPLE_INTERVAL_MS,
  registerMemoryGauge,
  registerMemoryGauges,
  sampleMemory,
  startMemorySampler,
} from './memorySampler';

const trace = vi.hoisted(() => ({
  recording: false,
  listeners: new Set<(status: DeepTraceRuntimeStatus) => void>(),
  record: vi.fn(),
}));

vi.mock('./deepTrace', () => ({
  isDeepTraceRecording: () => trace.recording,
  recordDeepTraceEvent: trace.record,
  subscribeDeepTraceStatus: (listener: (status: DeepTraceRuntimeStatus) => void) => {
    trace.listeners.add(listener);
    listener(trace.recording ? 'recording' : 'disabled');
    return () => trace.listeners.delete(listener);
  },
}));

const setStatus = (status: DeepTraceRuntimeStatus) => {
  trace.recording = status !== 'disabled' && status !== 'unavailable';
  trace.listeners.forEach((listener) => listener(status));
};

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
};

const samples = (): DeepTraceData[] =>
  trace.record.mock.calls
    .filter(([name]) => name === 'memory.sample')
    .map(([, data]) => data as DeepTraceData);

describe('memory sampler', () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    trace.recording = false;
    trace.listeners.clear();
    trace.record.mockClear();
    setVisibility('visible');
  });

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    vi.useRealTimers();
  });

  it('records one sample with every gauge and the reason as a flag', () => {
    trace.recording = true;
    cleanups.push(registerMemoryGauge('rooms', () => 12));
    cleanups.push(registerMemoryGauge('threads', () => 40));

    sampleMemory('thread_open');

    // The media counters go in their own event, ahead of the sample: one event keeps few fields.
    expect(trace.record).toHaveBeenCalledTimes(2);
    expect(trace.record.mock.calls.map(([name]) => name)).toEqual([
      'memory.media',
      'memory.sample',
    ]);
    expect(trace.record).toHaveBeenCalledWith(
      'memory.media',
      expect.objectContaining({
        reason_thread_open: true,
        object_urls: expect.any(Number) as number,
        images: expect.any(Number) as number,
        canvases: expect.any(Number) as number,
      }),
      // Queued; the sample's flush right after writes it.
      { flush: false }
    );
    expect(trace.record).toHaveBeenCalledWith(
      'memory.sample',
      expect.objectContaining({
        reason_thread_open: true,
        rooms: 12,
        threads: 40,
        dom_nodes: expect.any(Number) as number,
        uptime_s: expect.any(Number) as number,
      }),
      // Written at once: the reload it diagnoses would lose a queued sample.
      { flush: true }
    );
    // The reason goes first, ahead of the trace's field limit.
    expect(Object.keys(samples()[0]!)[0]).toBe('reason_thread_open');
  });

  it('writes interval samples with the next batch, and reads a group of gauges in one call', () => {
    trace.recording = true;
    const group = vi.fn(() => ({ rooms: 2, threads: 9, missing: undefined }));
    cleanups.push(registerMemoryGauges('matrix', group));

    sampleMemory('interval');

    expect(group).toHaveBeenCalledOnce();
    expect(samples()[0]).toMatchObject({ rooms: 2, threads: 9 });
    expect(samples()[0]).not.toHaveProperty('missing');
    expect(trace.record).toHaveBeenLastCalledWith('memory.sample', expect.anything(), {
      flush: false,
    });
  });

  it('skips a group that throws and keeps the other gauges', () => {
    trace.recording = true;
    cleanups.push(
      registerMemoryGauges('broken', () => {
        throw new Error('gone');
      })
    );
    cleanups.push(registerMemoryGauge('rooms', () => 3));

    sampleMemory('interval');

    expect(samples()[0]).toMatchObject({ rooms: 3, dom_nodes: expect.any(Number) as number });
  });

  it('skips a gauge that throws or has no value and keeps the others', () => {
    trace.recording = true;
    cleanups.push(
      registerMemoryGauge('broken', () => {
        throw new Error('gone');
      })
    );
    cleanups.push(registerMemoryGauge('missing', () => undefined));
    cleanups.push(registerMemoryGauge('rooms', () => 3));

    sampleMemory('interval');

    const [sample] = samples();
    expect(sample).toMatchObject({ reason_interval: true, rooms: 3 });
    expect(sample).not.toHaveProperty('broken');
    expect(sample).not.toHaveProperty('missing');
  });

  it('reports the WebAssembly memory of a module loaded after the sampler started', async () => {
    cleanups.push(startMemorySampler());
    // A module that exports one memory of 16 pages (1 MiB).
    await WebAssembly.instantiate(
      new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x05, 0x03, 0x01, 0x00, 0x10, 0x07, 0x07,
        0x01, 0x03, 0x6d, 0x65, 0x6d, 0x02, 0x00,
      ])
    );
    trace.recording = true;

    sampleMemory('interval');

    expect(samples()[0]).toMatchObject({ wasm_memory_mb: 1 });
  });

  it('reads no gauge while the deep trace is off', () => {
    const gauge = vi.fn(() => 1);
    cleanups.push(registerMemoryGauge('rooms', gauge));

    sampleMemory('interval');

    expect(gauge).not.toHaveBeenCalled();
    expect(trace.record).not.toHaveBeenCalled();
  });

  it('leaves an unregistered gauge out, and a newer gauge of the same name in', () => {
    trace.recording = true;
    const unregisterOld = registerMemoryGauge('rooms', () => 1);
    cleanups.push(registerMemoryGauge('rooms', () => 2));
    const unregisterThreads = registerMemoryGauge('threads', () => 5);
    unregisterOld();
    unregisterThreads();

    sampleMemory('interval');

    expect(samples()[0]).toMatchObject({ rooms: 2 });
    expect(samples()[0]).not.toHaveProperty('threads');
  });

  it('samples every minute while recording and visible, and once as the page hides', () => {
    cleanups.push(startMemorySampler());
    vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS * 2);
    expect(trace.record).not.toHaveBeenCalled();

    setStatus('recording');
    expect(samples()).toEqual([expect.objectContaining({ reason_start: true })]);
    vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS);
    expect(samples()).toHaveLength(2);
    expect(samples()[1]).toMatchObject({ reason_interval: true });

    setVisibility('hidden');
    expect(samples()).toHaveLength(3);
    expect(samples()[2]).toMatchObject({ reason_hidden: true });
    expect(trace.record).toHaveBeenLastCalledWith('memory.sample', expect.anything(), {
      flush: true,
    });
    // Hidden, the timer is stopped.
    vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS * 3);
    expect(samples()).toHaveLength(3);

    setVisibility('visible');
    vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS);
    expect(samples()).toHaveLength(4);
  });

  it('stops with the deep trace, and starting twice runs one sampler', () => {
    const stop = startMemorySampler();
    expect(startMemorySampler()).toBe(stop);
    cleanups.push(stop);
    setStatus('recording');
    vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS);
    expect(samples()).toHaveLength(2);

    setStatus('disabled');
    trace.record.mockClear();
    vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS * 3);
    setVisibility('hidden');
    expect(trace.record).not.toHaveBeenCalled();
  });

  it('records nothing once stopped', () => {
    const stop = startMemorySampler();
    setStatus('recording');
    stop();
    trace.record.mockClear();

    vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS * 2);
    setVisibility('hidden');

    expect(trace.record).not.toHaveBeenCalled();
    expect(trace.listeners.size).toBe(0);
  });
});
