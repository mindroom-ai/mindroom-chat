/**
 * Error reports for deployments whose `config.json` names a Sentry-compatible collector such as
 * GlitchTip (`errorReporting.dsn`). This module ships in the main bundle and stays small: from
 * startup it holds the failures that happen before the configuration is known, and it loads the
 * reporter (reporter.ts, its own chunk) only when a DSN is set and this device's "Send error
 * reports" setting is on. Without a DSN nothing is loaded and nothing leaves the device.
 */
import { useEffect } from 'react';
import { useClientConfig, type ClientConfig } from '../../config/useClientConfig';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useSetting } from '../../preferences/useSetting';
import { settingsAtom } from '../../preferences/settings';

type Reporter = typeof import('./reporter');

type ErrorReportingConfig = ClientConfig['errorReporting'];

/** Where reports go while they are on, built from config.json's `errorReporting`. */
export type ReportTarget = {
  /** The collector's envelope endpoint, or the tunnel on the app's own origin that forwards to it. */
  url: string;
  /** The DSN, which each envelope's header names. */
  dsn: string;
  /** The DSN's public key: each envelope carries it in its `X-Sentry-Auth` header. */
  key: string;
  /** The reports' environment. */
  environment: string;
};

/** Where a failure was caught. */
export type Mechanism = 'onerror' | 'onunhandledrejection' | 'react-error-boundary';

type Held = { value: unknown; mechanism: Mechanism; componentStack?: string };

type Place = { pathname: string; search: string };

// At most this many failures wait for the configuration; later ones are dropped.
const MAX_HELD = 20;

const held: Held[] = [];
let decided = false;
/** Where reports go while they are on. */
let target: ReportTarget | undefined;
let reporterModule: Promise<Reporter | undefined> | undefined;
let reporter: Reporter | undefined;
let place: Place | undefined;

/** A DSN (without any secret key), its envelope endpoint, its public key and the collector's host. */
export type Collector = { dsn: string; endpoint: string; key: string; host: string };

/**
 * The collector a DSN (`https://<public key>@<host>[/<path>]/<project id>`) names, or nothing for
 * an unusable one. Only HTTPS collectors count: reports must not cross the network in the clear.
 * The key stays out of the endpoint's address: privacy lists block addresses with `sentry_key=`.
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
    dsn: `https://${url.username}@${url.host}${path}`,
    endpoint: `https://${url.host}${path.slice(0, slash)}/api/${project}/envelope/`,
    key: url.username,
    host: url.host,
  };
};

/**
 * The address of a tunnel (`errorReporting.tunnel`): a path on the app's own origin whose server
 * forwards envelopes to the collector, where the privacy lists that block collectors do not look.
 * Nothing for an unset value or one on another origin.
 */
export const tunnelUrl = (
  tunnel: unknown,
  origin: string = window.location.origin
): string | undefined => {
  if (typeof tunnel !== 'string' || tunnel.trim() === '') return undefined;
  try {
    const url = new URL(tunnel.trim(), origin);
    return url.origin === origin ? url.href : undefined;
  } catch {
    return undefined;
  }
};

/** Where `config` sends reports: through its tunnel when it has one, else to the collector. */
const reportTarget = (config: ErrorReportingConfig): ReportTarget | undefined => {
  const collector = parseDsn(config?.dsn);
  if (!collector) return undefined;
  const environment = typeof config?.environment === 'string' ? config.environment.trim() : '';
  return {
    url: tunnelUrl(config?.tunnel) ?? collector.endpoint,
    dsn: collector.dsn,
    key: collector.key,
    environment: environment || window.location.hostname,
  };
};

const capture = (value: unknown, mechanism: Mechanism, componentStack?: string): void => {
  if (reporter && target) {
    reporter.captureError(value, mechanism, componentStack);
    return;
  }
  if (decided && !target) return;
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
  if (reporter && target) reporter.noteRoute(place.pathname, place.search);
};

const loadReporter = (): Promise<Reporter | undefined> => {
  reporterModule ??= import('./reporter').catch(() => undefined);
  return reporterModule;
};

/**
 * Turns reports on for `config` when its DSN is usable and `enabled` (the device setting), or
 * off. Resolves to the reporter while reports are on.
 */
export const configureErrorReporting = (
  config: ErrorReportingConfig,
  enabled: boolean
): Promise<Reporter | undefined> => {
  decided = true;
  const next = enabled ? reportTarget(config) : undefined;
  target = next;
  if (!next) {
    held.length = 0;
    reporter?.stopReporter();
    return Promise.resolve(undefined);
  }
  return loadReporter().then((loaded) => {
    // The configuration may have changed while the chunk loaded.
    if (!loaded || JSON.stringify(target) !== JSON.stringify(next)) return undefined;
    loaded.startReporter(next, place);
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
 * Applies the deployment's `errorReporting` and this device's setting, and follows the router's
 * location. For the component that owns the router.
 */
export const useErrorReporting = (config: ClientConfig, router: RouterLike): void => {
  const [enabled] = useSetting(settingsAtom, 'sendErrorReports');
  const { dsn, tunnel, environment } = config.errorReporting ?? {};
  useEffect(() => {
    configureErrorReporting({ dsn, tunnel, environment }, enabled).catch(() => undefined);
  }, [dsn, tunnel, environment, enabled]);
  useEffect(() => {
    noteRoute(router.state.location);
    return router.subscribe((state) => noteRoute(state.location));
  }, [router]);
};

/** Reports the signed-in account's sync, decryption and send failures while reports are on. */
export function ErrorReportingClientFeature(): null {
  const mx = useMatrixClient();
  const { dsn, tunnel, environment } = useClientConfig().errorReporting ?? {};
  const [enabled] = useSetting(settingsAtom, 'sendErrorReports');
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    configureErrorReporting({ dsn, tunnel, environment }, enabled)
      .then((loaded) => {
        if (!cancelled && loaded) stop = loaded.watchClient(mx);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [mx, dsn, tunnel, environment, enabled]);
  return null;
}
