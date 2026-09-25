import { AUTHENTICATION_RECOVERY_NAVIGATION_PARAM } from './serviceWorkerNavigation';

export type AuthenticationRecoveryResult =
  | 'disabled'
  | 'blocked'
  | 'navigating'
  | 'unavailable'
  | 'denied'
  | 'healthy';

export type AuthenticationRecovery = {
  check: () => Promise<AuthenticationRecoveryResult>;
  navigate: () => Promise<AuthenticationRecoveryResult>;
  configurationLoaded: () => void;
};

export type AuthenticationRecoveryWindow = Window & {
  __AUTHENTICATION_RECOVERY_CONFIG__?: unknown;
  __AUTHENTICATION_RECOVERY_READY__?: Promise<void>;
  __AUTHENTICATION_RECOVERY__?: AuthenticationRecovery;
};

/** Installs the standalone owner used by current and cached predecessor shells. */
export function installAuthenticationRecovery(window: AuthenticationRecoveryWindow): void {
  if (window.__AUTHENTICATION_RECOVERY__) return;
  const marker = AUTHENTICATION_RECOVERY_NAVIGATION_PARAM;
  const current = new URL(window.location.href);
  const value = window.__AUTHENTICATION_RECOVERY_CONFIG__;
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  let config: { probe: URL; navigation?: URL } | undefined;
  function localUrl(value: unknown): URL {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Missing URL');
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code < 32 || (code >= 127 && code <= 159))
        throw new Error('Unsafe recovery URL control character');
    }
    const path = value.trim().split(/[?#]/)[0];
    if (
      path.includes('\\') ||
      /%2f|%5c/i.test(path) ||
      /(^|\/)(?:\.|%2e)(?:\.|%2e)?(?=\/|$)/i.test(path)
    )
      throw new Error('Unsafe recovery URL path');
    // Page-relative paths would change the probe identity after a recovery navigation.
    if (!/^(?:\/(?!\/)|https?:\/\/)/i.test(value.trim()))
      throw new Error('Recovery URLs must be root-relative or absolute');
    const url = new URL(value, current);
    if (
      url.origin !== current.origin ||
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error('Recovery URLs must be same-origin HTTP URLs');
    return url;
  }
  try {
    if (raw)
      config = {
        probe: localUrl(raw.probeUrl),
        navigation:
          raw.navigationUrl === undefined || raw.navigationUrl === ''
            ? undefined
            : localUrl(raw.navigationUrl),
      };
  } catch {
    /* Invalid configuration disables automatic recovery. */
  }
  const timeout =
    raw && typeof raw.timeoutMs === 'number' && Number.isFinite(raw.timeoutMs)
      ? Math.min(30000, Math.max(1000, raw.timeoutMs))
      : 5000;
  const storageKey =
    'mindroom.authentication-recovery:' + (config ? config.probe.href : current.origin);
  let checking: Promise<AuthenticationRecoveryResult> | undefined;
  let navigating: Promise<AuthenticationRecoveryResult> | undefined;
  let lastAutomaticCheck = 0;

  function deadline<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Recovery timed out'));
        }, timeout);
      }),
    ]).finally(() => {
      clearTimeout(timer);
    });
  }

  function navigate(): Promise<AuthenticationRecoveryResult> {
    if (navigating) return navigating;
    navigating = (async (): Promise<AuthenticationRecoveryResult> => {
      try {
        // Record before any side effect. If storage is denied, do not risk a boot loop.
        if (window.sessionStorage.getItem(storageKey)) return 'blocked';
        window.sessionStorage.setItem(storageKey, '1');
        const workers = window.navigator.serviceWorker;
        const controller = workers && workers.controller;
        if (controller) {
          const registration = await deadline(workers.getRegistration(window.location.href));
          // A missing registration means another tab already unregistered it.
          if (registration) {
            if (registration.active !== controller) {
              return 'blocked';
            }
            await deadline(registration.unregister());
          }
        }
        const target = new URL(
          config && config.navigation ? config.navigation.href : window.location.href
        );
        if (!target.hash) target.hash = new URL(window.location.href).hash;
        target.searchParams.set(marker, '1');
        const source = new URL(window.location.href);
        if (target.pathname === source.pathname && target.search === source.search) {
          // Assigning an equal URL (or only a new fragment) is a same-document navigation.
          window.history.replaceState(window.history.state, '', target.href);
          window.location.reload();
        } else {
          window.location.assign(target.href);
        }
        return 'navigating';
      } catch {
        return 'blocked';
      }
    })().then((result) => {
      // A failed attempt remains bounded in storage, but restored authentication can reset it.
      if (result !== 'navigating') navigating = undefined;
      return result;
    });
    return navigating;
  }

  function check(): Promise<AuthenticationRecoveryResult> {
    if (!config) return Promise.resolve('disabled');
    if (navigating) return navigating;
    if (checking) return checking;
    const pending = (async (): Promise<AuthenticationRecoveryResult> => {
      if (window.navigator.onLine === false) return 'unavailable';
      const abort = new AbortController();
      const timer = setTimeout(() => {
        abort.abort();
      }, timeout);
      try {
        const response = await window.fetch(config.probe.href, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'same-origin',
          redirect: 'manual',
          signal: abort.signal,
        });
        if (response.status === 401 || response.type === 'opaqueredirect') return await navigate();
        // 403 can mean authenticated but unauthorized. Only the probe's exact 204 is healthy.
        if (response.status !== 204) return response.status === 403 ? 'denied' : 'unavailable';
        try {
          window.sessionStorage.removeItem(storageKey);
        } catch {
          /* Keep app usable. */
        }
        return 'healthy';
      } catch {
        return 'unavailable';
      } finally {
        clearTimeout(timer);
      }
    })().finally(() => {
      if (checking === pending) checking = undefined;
    });
    checking = pending;
    return checking;
  }

  function automaticCheck(): void {
    if (window.document.visibilityState === 'hidden') return;
    const now = Date.now();
    if (now - lastAutomaticCheck < 10000) return;
    lastAutomaticCheck = now;
    void check();
  }
  window.__AUTHENTICATION_RECOVERY__ = {
    check,
    configurationLoaded() {
      // Only fresh validated configuration can reset the unconfigured explicit sign-in path.
      if (!config) {
        try {
          window.sessionStorage.removeItem(storageKey);
        } catch {
          /* Keep app usable. */
        }
      }
    },
    // The existing sign-in action uses the same proof and budget when configured.
    navigate: config ? check : navigate,
  };
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    // History restoration resumes the same document after its navigation promise settled.
    navigating = undefined;
    checking = undefined;
    lastAutomaticCheck = 0;
    if (config) automaticCheck();
  });
  if (config) {
    window.addEventListener('focus', automaticCheck);
    window.addEventListener('online', automaticCheck);
    window.document.addEventListener('visibilitychange', automaticCheck);
    setInterval(automaticCheck, 60000);
    automaticCheck();
  }
}

/** Wait for the independent bootstrap before an explicit sign-in request. */
export async function recoverAuthentication(): Promise<AuthenticationRecoveryResult> {
  const recoveryWindow = window as AuthenticationRecoveryWindow;
  await recoveryWindow.__AUTHENTICATION_RECOVERY_READY__;
  return recoveryWindow.__AUTHENTICATION_RECOVERY__?.navigate() ?? 'unavailable';
}

export function authenticationConfigurationLoaded(): void {
  if (typeof window === 'undefined') return;
  const recoveryWindow = window as AuthenticationRecoveryWindow;
  void Promise.resolve(recoveryWindow.__AUTHENTICATION_RECOVERY_READY__)
    .then(() => recoveryWindow.__AUTHENTICATION_RECOVERY__?.configurationLoaded())
    .catch(() => undefined);
}
