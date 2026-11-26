import fs from 'node:fs';
import path from 'node:path';

export type UpdaterCheckOutcome = 'none' | 'found' | 'error';

export type UpdaterSupportOptions = {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  appImageEnv?: string;
  resourcesPath?: string;
  existsSync?: (target: string) => boolean;
};

/**
 * Returns whether electron-updater is supported in the current runtime.
 * macOS supports packaged updates; Linux supports AppImage only and explicitly rejects `.deb`
 * installs (identified by `resources/package-type`, even when `APPIMAGE` is inherited).
 */
export function isUpdaterSupported(options: UpdaterSupportOptions): boolean {
  if (!options.isPackaged) return false;
  if (options.platform === 'darwin') return true;
  if (options.platform === 'linux') {
    if (!options.appImageEnv?.trim()) return false;
    const resourcesPath = options.resourcesPath?.trim();
    if (!resourcesPath) return false;
    const exists = options.existsSync ?? fs.existsSync;
    return !exists(path.join(resourcesPath, 'package-type'));
  }
  return false;
}

type EventMethod = ((
  event: 'update-downloaded',
  listener: (info: { version: string }) => void
) => unknown) &
  ((event: 'error', listener: (error: Error) => void) => unknown);

export type AutoUpdaterLike = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on: EventMethod;
  removeListener: EventMethod;
  checkForUpdates(): Promise<
    | { readonly isUpdateAvailable?: boolean; readonly downloadPromise?: Promise<unknown> | null }
    | null
    | undefined
  >;
  quitAndInstall(): void;
};

export type UpdaterHandle = {
  readyVersion(): string | undefined;
  check(): Promise<UpdaterCheckOutcome>;
  install(): void;
  stop(): void;
};

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function startUpdater(
  autoUpdater: AutoUpdaterLike,
  onChange: () => void,
  options?: {
    onBeforeInstall?: () => void;
    logError?: (error: unknown) => void;
    intervalMs?: number;
  }
): UpdaterHandle {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const logError = options?.logError ?? ((error: unknown) => console.error('[updater]', error));
  let stagedVersion: string | undefined;
  let inFlight: Promise<UpdaterCheckOutcome> | undefined;
  let stopped = false;

  const onDownloaded = (info: { version?: unknown }): void => {
    const version = !stopped && typeof info?.version === 'string' ? info.version.trim() : '';
    if (!version || stagedVersion === version) return;
    stagedVersion = version;
    onChange();
  };
  const onError = (error: Error): void => {
    if (stopped) return;
    logError(error);
    if (stagedVersion !== undefined) {
      stagedVersion = undefined;
      onChange();
    }
  };
  autoUpdater.on('update-downloaded', onDownloaded);
  autoUpdater.on('error', onError);

  const check = (): Promise<UpdaterCheckOutcome> => {
    if (stagedVersion) return Promise.resolve('found');
    if (stopped) return Promise.resolve('none');
    if (inFlight) return inFlight;

    const run = (async (): Promise<UpdaterCheckOutcome> => {
      try {
        const res = await autoUpdater.checkForUpdates();
        if (res?.downloadPromise) void res.downloadPromise.catch(() => undefined);
        return res?.isUpdateAvailable ? 'found' : 'none';
      } catch (error) {
        logError(error);
        return 'error';
      }
    })().finally(() => {
      if (inFlight === run) inFlight = undefined;
    });
    inFlight = run;
    return run;
  };

  const timer = setInterval(() => {
    void check();
  }, options?.intervalMs ?? UPDATE_CHECK_INTERVAL_MS);
  timer.unref?.();
  void check();

  return {
    readyVersion: () => stagedVersion,
    check,
    install: () => {
      if (!stagedVersion) return;
      options?.onBeforeInstall?.();
      autoUpdater.quitAndInstall();
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      autoUpdater.removeListener('update-downloaded', onDownloaded);
      autoUpdater.removeListener('error', onError);
    },
  };
}
