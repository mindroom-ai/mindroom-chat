/**
 * Error reports for deployments whose `config.json` names a Sentry-compatible collector such as
 * GlitchTip (`errorReporting.dsn`). This module ships in the main bundle and stays small: from
 * startup it holds the failures that happen before the configuration is known, and it loads the
 * reporter (reporter.ts, its own chunk) only when a DSN is set and this device's "Send error
 * reports" setting is on. Without a DSN nothing is loaded and nothing leaves the device.
 */
import { useEffect } from 'react';
import { useClientConfig, type ClientConfig } from '../../hooks/useClientConfig';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';

type Reporter = typeof import('./reporter');

/** Where a failure was caught. */
export type Mechanism = 'onerror' | 'onunhandledrejection' | 'react-error-boundary';

type Held = { value: unknown; mechanism: Mechanism; componentStack?: string };

type Place = { pathname: string; search: string };

// At most this many failures wait for the configuration; later ones are dropped.
const MAX_HELD = 20;

const held: Held[] = [];
let decided = false;
/** The store endpoint while reports are on. */
let endpoint: string | undefined;
let reporterModule: Promise<Reporter | undefined> | undefined;
let reporter: Reporter | undefined;
let place: Place | undefined;

/** A DSN's store endpoint and the collector's host. */
export type Collector = { endpoint: string; host: string };

/**
 * The collector a DSN (`https://<public key>@<host>[/<path>]/<project id>`) names, or nothing for
 * an unusable one. Only HTTPS collectors count: reports must not cross the network in the clear.
 */
export const parseDsn = (dsn: unknown): Collector | undefined => {
  if (typeof dsn !== 'string') return undefined;
  let url: URL;
  try {
    url = new URL(dsn.trim());
  } catch {
    return undefined;
  }
  const path = url.pathname.replace(/\/+$/, '');
  const slash = path.lastIndexOf('/');
  const project = path.slice(slash + 1);
  if (url.protocol !== 'https:' || !url.username || !/^\d+$/.test(project)) return undefined;
  return {
    endpoint: `https://${url.host}${path.slice(0, slash)}/api/${project}/store/?sentry_key=${
      url.username
    }&sentry_version=7`,
    host: url.host,
  };
};

const capture = (value: unknown, mechanism: Mechanism, componentStack?: string): void => {
  if (reporter && endpoint) {
    reporter.captureError(value, mechanism, componentStack);
    return;
  }
  if (decided && !endpoint) return;
  if (held.length < MAX_HELD) held.push({ value, mechanism, componentStack });
};

const onError = (event: ErrorEvent): void => {
  if (event.error !== undefined && event.error !== null) {
    capture(event.error, 'onerror');
    return;
  }
  // "Script error." is all a cross-origin script's failure tells; it says nothing.
  if (!event.message || event.message === 'Script error.') return;
  capture(
    {
      name: 'Error',
      message: event.message,
      stack: event.filename
        ? `Error\n    at ${event.filename}:${event.lineno}:${event.colno}`
        : undefined,
    },
    'onerror'
  );
};

const onRejection = (event: PromiseRejectionEvent): void => {
  capture(event.reason, 'onunhandledrejection');
};

/** Starts listening for uncaught errors and rejections; call once, first thing at startup. */
export const installErrorCapture = (): void => {
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
};

/** Reports an error the app's root error boundary caught, with React's component stack. */
export const reportBoundaryError = (error: unknown, componentStack?: string | null): void => {
  capture(error, 'react-error-boundary', componentStack ?? undefined);
};

/** Records the page the app shows, for the reports' route and the reporter's room timings. */
const noteRoute = (next: Place): void => {
  if (place?.pathname === next.pathname && place.search === next.search) return;
  place = { pathname: next.pathname, search: next.search };
  if (reporter && endpoint) reporter.noteRoute(place.pathname, place.search);
};

const loadReporter = (): Promise<Reporter | undefined> => {
  reporterModule ??= import('./reporter').catch(() => undefined);
  return reporterModule;
};

/**
 * Turns reports on for `dsn` when it is usable and `enabled` (the device setting), or off.
 * Resolves to the reporter while reports are on.
 */
export const configureErrorReporting = (
  dsn: string | undefined,
  enabled: boolean
): Promise<Reporter | undefined> => {
  decided = true;
  const collector = enabled ? parseDsn(dsn) : undefined;
  endpoint = collector?.endpoint;
  if (!collector) {
    held.length = 0;
    reporter?.stopReporter();
    return Promise.resolve(undefined);
  }
  return loadReporter().then((loaded) => {
    // The configuration may have changed while the chunk loaded.
    if (!loaded || endpoint !== collector.endpoint) return undefined;
    loaded.startReporter(collector.endpoint, place);
    reporter = loaded;
    held
      .splice(0)
      .forEach((item) => loaded.captureError(item.value, item.mechanism, item.componentStack));
    return loaded;
  });
};

type RouterLike = {
  state: { location: Place };
  subscribe: (listener: (state: { location: Place }) => void) => () => void;
};

/**
 * Applies the deployment's DSN and this device's setting, and follows the router's location.
 * For the component that owns the router.
 */
export const useErrorReporting = (config: ClientConfig, router: RouterLike): void => {
  const [enabled] = useSetting(settingsAtom, 'sendErrorReports');
  const dsn = config.errorReporting?.dsn;
  useEffect(() => {
    configureErrorReporting(dsn, enabled).catch(() => undefined);
  }, [dsn, enabled]);
  useEffect(() => {
    noteRoute(router.state.location);
    return router.subscribe((state) => noteRoute(state.location));
  }, [router]);
};

/** Reports the signed-in account's sync, decryption and send failures while reports are on. */
export function ErrorReportingClientFeature(): null {
  const mx = useMatrixClient();
  const dsn = useClientConfig().errorReporting?.dsn;
  const [enabled] = useSetting(settingsAtom, 'sendErrorReports');
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    configureErrorReporting(dsn, enabled)
      .then((loaded) => {
        if (!cancelled && loaded) stop = loaded.watchClient(mx);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [mx, dsn, enabled]);
  return null;
}
