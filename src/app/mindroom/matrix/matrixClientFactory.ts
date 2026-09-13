import { createClient, type ICreateClientOpts } from 'matrix-js-sdk';
import { traceDeepDiagnosticFetch } from '../diagnostics/deepTrace';

type MindroomCreateClientOpts = ICreateClientOpts & {
  threadSupport?: boolean;
};

type RuntimeLocation = {
  origin: string;
};

const getRuntimeOrigin = (): string | undefined => {
  if (typeof globalThis === 'undefined') return undefined;
  const { location } = globalThis as { location?: RuntimeLocation };
  if (!location?.origin) return undefined;
  return location.origin;
};

const resolveRequestUrl = (input: Parameters<typeof fetch>[0]): URL | null => {
  try {
    if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
    if (input instanceof URL) return input;
    return new URL(String(input), getRuntimeOrigin());
  } catch {
    return null;
  }
};

const isSameOriginRequest = (input: Parameters<typeof fetch>[0]): boolean => {
  const origin = getRuntimeOrigin();
  if (!origin) return false;
  const url = resolveRequestUrl(input);
  if (!url) return false;
  return url.origin === origin;
};

export const createMatrixFetchFn =
  (baseFetch: typeof globalThis.fetch = globalThis.fetch): typeof globalThis.fetch =>
  (input, init) =>
    !isSameOriginRequest(input)
      ? traceDeepDiagnosticFetch(baseFetch, input, init)
      : traceDeepDiagnosticFetch(baseFetch, input, {
          ...init,
          credentials: 'include',
        });

export const createMatrixClient = (options: MindroomCreateClientOpts) =>
  createClient({
    ...options,
    fetchFn: createMatrixFetchFn(options.fetchFn ?? globalThis.fetch),
  } as ICreateClientOpts);
