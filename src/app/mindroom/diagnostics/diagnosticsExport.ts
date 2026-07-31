import { APP_BUILD_VERSION } from '../../../appVersion';
import {
  buildFlightRecorderPayload,
  FLIGHT_RECORDER_SCHEMA_VERSION,
  normalizeFlightRecorderBuildVersion,
} from './flightRecorder';
import { DEEP_TRACE_SCHEMA_VERSION, getDeepTraceEnabled, readDeepTraceSnapshot } from './deepTrace';

export const DIAGNOSTICS_EXPORT_SCHEMA_VERSION = 2;

export const buildDiagnosticsExport = async (): Promise<{ fileName: string; blob: Blob }> => {
  const exportedAt = Date.now();
  let flightRecorderPayload: ReturnType<typeof buildFlightRecorderPayload>;
  let flightRecorderStatus: 'available' | 'unavailable' = 'available';
  let deepTrace: Awaited<ReturnType<typeof readDeepTraceSnapshot>>;

  try {
    flightRecorderPayload = buildFlightRecorderPayload();
  } catch {
    flightRecorderStatus = 'unavailable';
    flightRecorderPayload = {
      metadata: {
        exportSchemaVersion: FLIGHT_RECORDER_SCHEMA_VERSION,
        flightRecorderSchemaVersion: FLIGHT_RECORDER_SCHEMA_VERSION,
        buildVersion: normalizeFlightRecorderBuildVersion(APP_BUILD_VERSION),
        exportedAt,
      },
      abnormalSession: null,
      currentOrPreservedSession: null,
    };
  }

  try {
    deepTrace = await readDeepTraceSnapshot();
  } catch {
    deepTrace = {
      schemaVersion: DEEP_TRACE_SCHEMA_VERSION,
      enabled: getDeepTraceEnabled(),
      status: 'unavailable',
      stats: {
        eventCount: 0,
        byteCount: 0,
        droppedEventCount: 0,
        oldestAt: null,
        newestAt: null,
      },
      events: [],
    };
  }

  const payload = {
    ...flightRecorderPayload,
    flightRecorderStatus,
    metadata: {
      ...flightRecorderPayload.metadata,
      exportSchemaVersion: DIAGNOSTICS_EXPORT_SCHEMA_VERSION,
      flightRecorderSchemaVersion: FLIGHT_RECORDER_SCHEMA_VERSION,
      deepTraceSchemaVersion: DEEP_TRACE_SCHEMA_VERSION,
      exportedAt,
    },
    deepTrace,
  };
  const timestamp = new Date(exportedAt).toISOString().replace(/[:.]/g, '-');
  return {
    fileName: `mindroom-diagnostics-${timestamp}.json`,
    blob: new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
  };
};
