import { ReactNode, useCallback, useEffect, useState } from 'react';
import { type SpecVersions, specVersions } from '../cs-api';

const EMPTY_VERSIONS: SpecVersions = { versions: [] };

type LoaderState =
  | { status: 'loading' }
  | { status: 'loaded'; versions: SpecVersions }
  | { status: 'error'; error: unknown };

type SpecVersionsLoaderProps = {
  baseUrl: string;
  /** The request function, for example one that adds the session's access token. */
  fetchFn?: typeof fetch;
  /** Shown while the server has not answered. */
  fallback?: () => ReactNode;
  /** Shown when the request failed; `ignore` continues as if the server listed no versions. */







  fetchFn,
  fallback,
  error,
  children,
}: SpecVersionsLoaderProps) {
  const [state, setState] = useState<LoaderState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setState({ status: 'loading' });
    specVersions(fetchFn ?? fetch, baseUrl).then(
      (versions) => {
        if (current) setState({ status: 'loaded', versions });
      },
      (requestError: unknown) => {
        if (current) setState({ status: 'error', error: requestError });
      }
    );
    return () => {
      current = false;
    };
  }, [baseUrl, fetchFn, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const ignore = useCallback(() => setState({ status: 'loaded', versions: EMPTY_VERSIONS }), []);

  if (state.status === 'loading') return fallback?.() ?? null;
  if (state.status === 'error') return error?.(state.error, retry, ignore) ?? null;
  return children(state.versions);
}
