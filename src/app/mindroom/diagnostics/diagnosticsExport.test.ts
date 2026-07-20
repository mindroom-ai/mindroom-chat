import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildFlightRecorderPayload: vi.fn(),
  readDeepTraceSnapshot: vi.fn(),
}));

vi.mock('./flightRecorder', () => ({
  FLIGHT_RECORDER_SCHEMA_VERSION: 1,
  buildFlightRecorderPayload: mocks.buildFlightRecorderPayload,
  normalizeFlightRecorderBuildVersion: (value: string) => value,
}));

vi.mock('./deepTrace', () => ({
  DEEP_TRACE_SCHEMA_VERSION: 1,
  readDeepTraceSnapshot: mocks.readDeepTraceSnapshot,
}));

import { buildDiagnosticsExport } from './diagnosticsExport';

describe('combined diagnostics export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(1_784_513_628_415);
    mocks.buildFlightRecorderPayload.mockReturnValue({
      metadata: {
        exportSchemaVersion: 1,
        flightRecorderSchemaVersion: 1,
        buildVersion: 'build-sha',
        exportedAt: 1,
      },
      abnormalSession: { sessionId: 'abnormal' },
      currentOrPreservedSession: { sessionId: 'current' },
    });
    mocks.readDeepTraceSnapshot.mockResolvedValue({
      schemaVersion: 1,
      enabled: true,
      status: 'recording',
      stats: {
        eventCount: 1,
        byteCount: 100,
        droppedEventCount: 0,
        oldestAt: 10,
        newestAt: 10,
      },
      events: [{ name: 'thread_resume.visibility.start' }],
    });
  });

  it('exports flight evidence and the retained deep trace under a versioned envelope', async () => {
    const { blob, fileName } = await buildDiagnosticsExport();
    const payload = JSON.parse(await blob.text());

    expect(fileName).toBe('mindroom-diagnostics-2026-07-20T02-13-48-415Z.json');
    expect(payload.metadata).toEqual({
      exportSchemaVersion: 2,
      flightRecorderSchemaVersion: 1,
      deepTraceSchemaVersion: 1,
      buildVersion: 'build-sha',
      exportedAt: 1_784_513_628_415,
    });
    expect(payload.abnormalSession).toEqual({ sessionId: 'abnormal' });
    expect(payload.currentOrPreservedSession).toEqual({ sessionId: 'current' });
    expect(payload.flightRecorderStatus).toBe('available');
    expect(payload.deepTrace).toMatchObject({
      enabled: true,
      status: 'recording',
      events: [{ name: 'thread_resume.visibility.start' }],
    });
  });

  it('still exports the flight record when deep trace storage is unavailable', async () => {
    mocks.readDeepTraceSnapshot.mockRejectedValue(new Error('IndexedDB blocked'));

    const payload = JSON.parse(await (await buildDiagnosticsExport()).blob.text());

    expect(payload.abnormalSession).toEqual({ sessionId: 'abnormal' });
    expect(payload.deepTrace).toEqual({
      schemaVersion: 1,
      enabled: false,
      status: 'unavailable',
      stats: {
        eventCount: 0,
        byteCount: 0,
        droppedEventCount: 0,
        oldestAt: null,
        newestAt: null,
      },
      events: [],
    });
  });

  it('still exports a healthy deep trace when flight-recorder storage is unavailable', async () => {
    mocks.buildFlightRecorderPayload.mockImplementation(() => {
      throw new Error('localStorage blocked');
    });

    const payload = JSON.parse(await (await buildDiagnosticsExport()).blob.text());

    expect(payload.flightRecorderStatus).toBe('unavailable');
    expect(payload.abnormalSession).toBeNull();
    expect(payload.currentOrPreservedSession).toBeNull();
    expect(payload.deepTrace).toMatchObject({
      status: 'recording',
      events: [{ name: 'thread_resume.visibility.start' }],
    });
  });
});
