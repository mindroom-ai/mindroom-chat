import { Capacitor } from '@capacitor/core';
import { getMindRoomAuthPlugin, isNativeIOS } from './nativeSso';
import { getActiveSession, subscribeToSessionStore } from '../../state/sessions';

const ACCESS_TOKEN_HEADER = 'Cf-Access-Token';
const TOKEN_EXPIRY_SKEW_MS = 60_000;
export const CLOUDFLARE_ACCESS_AUTHENTICATED_EVENT = 'mindroom-cloudflare-access-authenticated';

type CloudflareAccessTokenResult = {
  expiresAtMs?: number;
  protected: boolean;
  token?: string;
};

export type CloudflareAccessPlugin = {
  cloudflareAccessToken(options: {
    forceRefresh: boolean;
    interactive: boolean;
    url: string;
  }): Promise<CloudflareAccessTokenResult>;
};

type AccessState = {
  expiresAtMs?: number;
  protected: boolean;
  token?: string;
};

export type CloudflareAccessRequirement = {
  message: string;
  scope: string;
  url: string;
};

type CloudflareAccessControllerOptions = {
  baseFetch: typeof globalThis.fetch;
  isVisible?: () => boolean;
  now?: () => number;
  onAuthentication?: () => void;
  plugin: CloudflareAccessPlugin;
};

type PluginError = Error & { code?: string };

const makePluginError = (code: string, message: string): PluginError => {
  const error = new Error(message) as PluginError;
  error.code = code;
  return error;
};

const getPluginErrorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;

const getPluginErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Organization sign-in is required';

const resolveRequestUrl = (input: RequestInfo | URL): URL | undefined => {
  try {
    if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
    if (input instanceof URL) return input;
    return new URL(String(input), globalThis.location?.href);
  } catch {
    return undefined;
  }
};

const getMatrixPathParts = (url: URL): { prefix: string; scope: string } | undefined => {
  if (url.protocol !== 'https:') return undefined;
  const marker = '/_matrix/';
  const markerIndex = url.pathname.indexOf(marker);
  if (markerIndex < 0) return undefined;
  const prefix = url.pathname.slice(0, markerIndex);
  return {
    prefix,
    scope: `${url.origin}${prefix}/_matrix`,
  };
};

const getDirectHttpsHomeserver = (
  server: string
): { baseUrl: string; probeUrl: URL } | undefined => {
  try {
    const url = new URL(/^https?:\/\//i.test(server) ? server : `https://${server}`);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password)
      return undefined;
    const normalizedPath = url.pathname.replace(/\/+$/, '');
    const baseUrl = `${url.origin}${normalizedPath}`;
    const probeUrl = new URL(`${normalizedPath}/_matrix/client/versions`, url.origin);
    return { baseUrl, probeUrl };
  } catch {
    return undefined;
  }
};

export const getCloudflareAccessProbeUrl = (url: URL): URL | undefined => {
  const parts = getMatrixPathParts(url);
  if (!parts) return undefined;
  return new URL(`${parts.prefix}/_matrix/client/versions`, url.origin);
};

const requestWithAccessToken = (
  baseFetch: typeof globalThis.fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  token: string,
  redirect: RequestRedirect | undefined
): Promise<Response> => {
  const headers = new Headers(
    typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined
  );
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
  headers.set(ACCESS_TOKEN_HEADER, token);
  return baseFetch(input, { ...init, headers, ...(redirect ? { redirect } : {}) });
};

const isAccessRejection = (response: Response): boolean => {
  try {
    const responseUrl = new URL(response.url);
    if (
      response.redirected &&
      (responseUrl.pathname === '/cdn-cgi/access/login' ||
        responseUrl.pathname.startsWith('/cdn-cgi/access/login/'))
    ) {
      return true;
    }
  } catch {
    // A missing response URL is normal for mocked and opaque responses.
  }

  if (response.type === 'opaqueredirect') return true;
  if (response.status !== 401 && response.status !== 403) return false;
  return Boolean(response.headers.get('CF-Access-Aud') || response.headers.get('CF-Access-Domain'));
};

const isAuthRequiredCode = (code: string | undefined): boolean =>
  code === 'ACCESS_AUTH_REQUIRED' ||
  code === 'ACCESS_AUTH_CANCELLED' ||
  code === 'ACCESS_TOKEN_TRANSFER_FAILED' ||
  code === 'ACCESS_AUTH_FAILED';

export class CloudflareAccessController {
  private readonly baseFetch: typeof globalThis.fetch;

  private readonly plugin: CloudflareAccessPlugin;

  private readonly now: () => number;

  private readonly isVisible: () => boolean;

  private readonly onAuthentication: () => void;

  private readonly states = new Map<string, AccessState>();

  private readonly inFlight = new Map<string, Promise<AccessState>>();

  private readonly listeners = new Set<() => void>();

  private readonly interactiveScopes = new Set<string>();

  private readonly allowedScopes = new Set<string>();

  private readonly suppressedScopes = new Set<string>();

  private requirement: CloudflareAccessRequirement | undefined;

  constructor({
    baseFetch,
    plugin,
    now = Date.now,
    isVisible,
    onAuthentication = () => undefined,
  }: CloudflareAccessControllerOptions) {
    this.baseFetch = baseFetch;
    this.plugin = plugin;
    this.now = now;
    this.isVisible =
      isVisible ??
      (() => typeof document === 'undefined' || document.visibilityState === 'visible');
    this.onAuthentication = onAuthentication;
  }

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const url = resolveRequestUrl(input);
    const pathParts = url ? getMatrixPathParts(url) : undefined;
    if (!url || !pathParts) return this.baseFetch(input, init);

    const cached = this.states.get(pathParts.scope);
    if (!cached && !this.allowedScopes.has(pathParts.scope)) {
      return this.baseFetch(input, init);
    }
    if (this.suppressedScopes.has(pathParts.scope)) {
      return this.baseFetch(input, init);
    }

    let state: AccessState;
    try {
      const interactive =
        this.interactiveScopes.has(pathParts.scope) &&
        !cached?.token &&
        !this.requirement &&
        this.isVisible();
      state = await this.ensureState(url, interactive, false);
    } catch (error) {
      if (getPluginErrorCode(error) === 'ACCESS_DISCOVERY_FAILED') {
        return this.baseFetch(input, init);
      }
      throw error;
    }

    if (!state.protected || !state.token) return this.baseFetch(input, init);

    const normalizedRequest = new Request(input, init);
    const firstInput = normalizedRequest.clone();
    const retryInput = normalizedRequest.clone();
    const normalizedInit = undefined;

    const response = await requestWithAccessToken(
      this.baseFetch,
      firstInput,
      normalizedInit,
      state.token,
      'manual'
    );
    if (!isAccessRejection(response)) return response;

    try {
      const refreshed = await this.ensureState(url, false, true);
      if (!refreshed.protected || !refreshed.token) return response;
      const retryResponse = await requestWithAccessToken(
        this.baseFetch,
        retryInput,
        normalizedInit,
        refreshed.token,
        'manual'
      );
      if (isAccessRejection(retryResponse)) {
        this.states.set(pathParts.scope, { protected: true });
        this.setRequirement({
          message: 'Organization sign-in is required',
          scope: pathParts.scope,
          url: getCloudflareAccessProbeUrl(url)?.toString() ?? url.toString(),
        });
      }
      return retryResponse;
    } catch {
      // Preserve first Access response. Explicit foreground prompt owns any
      // interactive retry, preventing sync from opening browser-sheet loops.
      return response;
    }
  };

  getRequirement = (): CloudflareAccessRequirement | undefined => this.requirement;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  allowHomeserver = (baseUrl: string, interactive = true): void => {
    try {
      const url = new URL(baseUrl);
      const probeUrl = new URL(
        `${url.pathname.replace(/\/+$/, '')}/_matrix/client/versions`,
        url.origin
      );
      const parts = getMatrixPathParts(probeUrl);
      if (parts) {
        this.allowedScopes.add(parts.scope);
        if (interactive) {
          this.interactiveScopes.add(parts.scope);
          this.suppressedScopes.delete(parts.scope);
        }
      }
    } catch {
      // Invalid homeservers remain on ordinary Matrix error handling.
    }
  };

  probeProtectedHomeserver = async (server: string): Promise<string | undefined> => {
    const direct = getDirectHttpsHomeserver(server);
    if (!direct) return undefined;
    const pathParts = getMatrixPathParts(direct.probeUrl);
    if (!pathParts) return undefined;

    this.allowHomeserver(direct.baseUrl);
    try {
      const response = await this.fetch(direct.probeUrl, { method: 'GET' });
      const state = this.states.get(pathParts.scope);
      if (!response.ok || state?.protected !== true || !state.token) return undefined;
      return direct.baseUrl;
    } catch {
      // Authentication cancellation and failure are represented by the
      // controller requirement. Preserve ordinary discovery's error state.
      return undefined;
    }
  };

  retryAuthentication = async (): Promise<void> => {
    const requirement = this.requirement;
    if (!requirement) return;
    const url = new URL(requirement.url);
    this.suppressedScopes.delete(requirement.scope);
    await this.ensureState(url, true, false);
    this.onAuthentication();
  };

  dismissRequirement = (): void => {
    const requirement = this.requirement;
    if (!requirement) return;
    this.suppressedScopes.add(requirement.scope);
    this.setRequirement(undefined);
  };

  private async ensureState(
    requestUrl: URL,
    interactive: boolean,
    forceRefresh: boolean
  ): Promise<AccessState> {
    const pathParts = getMatrixPathParts(requestUrl);
    const probeUrl = getCloudflareAccessProbeUrl(requestUrl);
    if (!pathParts || !probeUrl) return { protected: false };

    const cached = this.states.get(pathParts.scope);
    if (!forceRefresh && cached?.protected === false) return cached;
    if (
      !forceRefresh &&
      cached?.protected &&
      cached.token &&
      cached.expiresAtMs &&
      cached.expiresAtMs - this.now() > TOKEN_EXPIRY_SKEW_MS
    ) {
      return cached;
    }
    if (!forceRefresh && cached?.protected && this.requirement && !interactive) {
      throw makePluginError('ACCESS_AUTH_REQUIRED', this.requirement.message);
    }

    const inFlightKey = `${pathParts.scope}:${forceRefresh ? 'refresh' : 'ensure'}:${
      interactive ? 'interactive' : 'silent'
    }`;
    const existing = this.inFlight.get(inFlightKey);
    if (existing) return existing;

    const request = this.requestToken(pathParts.scope, probeUrl, interactive, forceRefresh).finally(
      () => {
        this.inFlight.delete(inFlightKey);
      }
    );
    this.inFlight.set(inFlightKey, request);
    return request;
  }

  private async requestToken(
    scope: string,
    probeUrl: URL,
    interactive: boolean,
    forceRefresh: boolean
  ): Promise<AccessState> {
    try {
      const result = await this.plugin.cloudflareAccessToken({
        forceRefresh,
        interactive,
        url: probeUrl.toString(),
      });
      const state: AccessState = result.protected
        ? {
            expiresAtMs: result.expiresAtMs,
            protected: true,
            token: result.token,
          }
        : { protected: false };
      if (state.protected && (!state.token || !state.expiresAtMs)) {
        throw makePluginError(
          'ACCESS_AUTH_FAILED',
          'Organization authentication returned no token'
        );
      }
      this.states.set(scope, state);
      if (state.protected && state.token) this.suppressedScopes.delete(scope);
      if (this.requirement?.scope === scope) this.setRequirement(undefined);
      return state;
    } catch (error) {
      const code = getPluginErrorCode(error);
      if (isAuthRequiredCode(code)) {
        this.states.set(scope, { protected: true });
        this.setRequirement({
          message: getPluginErrorMessage(error),
          scope,
          url: probeUrl.toString(),
        });
      }
      throw error;
    }
  }

  private setRequirement(requirement: CloudflareAccessRequirement | undefined): void {
    this.requirement = requirement;
    this.listeners.forEach((listener) => listener());
  }
}

let installedController: CloudflareAccessController | undefined;
let stopSessionSubscription: (() => void) | undefined;

export const installCloudflareAccessFetch = (): void => {
  if (installedController || !isNativeIOS() || !Capacitor.isPluginAvailable('MindRoomAuth')) {
    return;
  }
  installedController = new CloudflareAccessController({
    baseFetch: globalThis.fetch.bind(globalThis),
    onAuthentication: () => window.dispatchEvent(new Event(CLOUDFLARE_ACCESS_AUTHENTICATED_EVENT)),
    plugin: getMindRoomAuthPlugin() as CloudflareAccessPlugin,
  });
  const allowActiveSession = () => {
    const session = getActiveSession();
    if (session) installedController?.allowHomeserver(session.baseUrl, false);
  };
  allowActiveSession();
  stopSessionSubscription?.();
  stopSessionSubscription = subscribeToSessionStore(allowActiveSession);
  globalThis.fetch = installedController.fetch;
};

export const allowCloudflareAccessForHomeserver = (baseUrl: string): void => {
  installedController?.allowHomeserver(baseUrl);
};

export const probeCloudflareAccessHomeserver = async (
  server: string
): Promise<string | undefined> => installedController?.probeProtectedHomeserver(server);

export const getCloudflareAccessRequirement = (): CloudflareAccessRequirement | undefined =>
  installedController?.getRequirement();

export const subscribeToCloudflareAccessRequirement = (listener: () => void): (() => void) =>
  installedController?.subscribe(listener) ?? (() => undefined);

export const retryCloudflareAccessAuthentication = async (): Promise<void> => {
  await installedController?.retryAuthentication();
};

export const dismissCloudflareAccessRequirement = (): void => {
  installedController?.dismissRequirement();
};
