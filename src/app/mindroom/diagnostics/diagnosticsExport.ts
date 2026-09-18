import { APP_BUILD_VERSION } from '../../../appVersion';
import {
  buildFlightRecorderPayload,
  FLIGHT_RECORDER_SCHEMA_VERSION,
  normalizeFlightRecorderBuildVersion,
} from './flightRecorder';
import {
  DEEP_TRACE_SCHEMA_VERSION,
  getDeepTraceEnabled,
  getDeepTraceHealthSnapshot,
  readDeepTraceSnapshot,
  type DeepTraceSnapshot,
} from './deepTrace';
import {
  createEmptyNativeDiagnosticsSnapshot,
  NATIVE_DIAGNOSTICS_SCHEMA_VERSION,
  readNativeDiagnostics,
} from './nativeDiagnostics';

export const DIAGNOSTICS_EXPORT_SCHEMA_VERSION = 3;

const COLLECTOR_TIMEOUT_MS = 5_000;

const emptyDeepTraceSnapshot = (
  status: Extract<DeepTraceSnapshot['status'], 'unavailable' | 'timeout'>
): DeepTraceSnapshot => ({
  schemaVersion: DEEP_TRACE_SCHEMA_VERSION,
  enabled: getDeepTraceEnabled(),
  status,
  stats: {
    eventCount: 0,
    byteCount: 0,
    droppedEventCount: 0,
    oldestAt: null,
    newestAt: null,
  },
  events: [],
});

const withDeadline = async <T>(collector: Promise<T>, timeoutValue: T): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      collector,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(timeoutValue), COLLECTOR_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const collectDeepTrace = (): Promise<DeepTraceSnapshot> =>
  withDeadline(
    readDeepTraceSnapshot().catch(() => emptyDeepTraceSnapshot('unavailable')),
    emptyDeepTraceSnapshot('timeout')
  );

const collectNativeDiagnostics = () =>
  withDeadline(
    readNativeDiagnostics().catch(() => createEmptyNativeDiagnosticsSnapshot('unavailable')),
    createEmptyNativeDiagnosticsSnapshot('timeout')
  );

export const buildDiagnosticsExport = async (): Promise<{ fileName: string; blob: Blob }> => {
  const exportedAt = Date.now();
  let flightRecorderPayload: ReturnType<typeof buildFlightRecorderPayload>;
  let flightRecorderStatus: 'available' | 'unavailable' = 'available';

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

  const deepTraceHealth = getDeepTraceHealthSnapshot();
  const [deepTrace, nativeDiagnostics] = await Promise.all([
    collectDeepTrace(),
    collectNativeDiagnostics(),
  ]);

  const payload = {
    ...flightRecorderPayload,
    flightRecorderStatus,
    metadata: {
      ...flightRecorderPayload.metadata,
      exportSchemaVersion: DIAGNOSTICS_EXPORT_SCHEMA_VERSION,
      flightRecorderSchemaVersion: FLIGHT_RECORDER_SCHEMA_VERSION,
      deepTraceSchemaVersion: DEEP_TRACE_SCHEMA_VERSION,
      nativeDiagnosticsSchemaVersion: NATIVE_DIAGNOSTICS_SCHEMA_VERSION,
      exportedAt,
    },
    deepTrace,
    deepTraceHealth,
    nativeDiagnostics,
  };
  const timestamp = new Date(exportedAt).toISOString().replace(/[:.]/g, '-');
  return {
    fileName: `mindroom-diagnostics-${timestamp}.json`,
    blob: new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
  };
};
