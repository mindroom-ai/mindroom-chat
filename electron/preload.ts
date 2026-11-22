import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, DesktopResult, DesktopShellEvent } from '../src/app/lib/desktopBridge';

const externalUrlForClick = (event: MouseEvent): string | undefined => {
  if (!event.isTrusted || event.button !== (event.type === 'click' ? 0 : 1)) return undefined;
  const hit = event
    .composedPath()
    .find(
      (node): node is HTMLAnchorElement | HTMLButtonElement =>
        (node instanceof HTMLAnchorElement && node.hasAttribute('href')) ||
        (node instanceof HTMLButtonElement && node.hasAttribute('data-open-external'))
    );
  // A non-editable island inside an editable area (e.g. a mention pill) still opens, as on web.
  if (!hit || hit.isContentEditable) return undefined;
  if (hit instanceof HTMLButtonElement) {
    return event.type === 'click' && !hit.disabled
      ? hit.getAttribute('data-open-external') || undefined
      : undefined;
  }
  try {
    const parsed = new URL(hit.href, window.location.href);
    return parsed.origin !== window.location.origin ? parsed.href : undefined;
  } catch {
    return undefined;
  }
};

const onExternalClick = (event: MouseEvent): void => {
  const url = externalUrlForClick(event);
  if (!url) return;
  setTimeout(() => {
    if (!event.defaultPrevented) {
      void ipcRenderer.invoke('desktop:open-external', url).catch(() => undefined);
    }
  }, 0);
};
window.addEventListener('click', onExternalClick, true);
window.addEventListener('auxclick', onExternalClick, true);

const takeAppUrl = async (): Promise<string | undefined> => {
  const res = (await ipcRenderer.invoke('desktop:take-app-url')) as DesktopResult<
    string | undefined
  >;
  return res.ok ? res.value : undefined;
};

const bridge = {
  onShellEvent: (listener: (event: DesktopShellEvent) => void): (() => void) => {
    const handle = (_event: Electron.IpcRendererEvent, payload: DesktopShellEvent): void => {
      listener(payload);
    };
    ipcRenderer.on('desktop:shell-event', handle);
    return () => {
      ipcRenderer.removeListener('desktop:shell-event', handle);
    };
  },
  setMediaSession: (session) => ipcRenderer.sendSync('desktop:set-media-session', session),
  startSignIn: (request) => ipcRenderer.invoke('desktop:start-sign-in', request),
  openSignIn: (url) => ipcRenderer.invoke('desktop:open-sign-in', url),
  appUrl: {
    getLaunchUrl: async () => {
      const url = await takeAppUrl();
      return url ? { url } : undefined;
    },
    addListener: (eventName, listener) => {
      if (eventName !== 'appUrlOpen') return Promise.resolve({ remove: () => undefined });
      const handle = (): void => {
        void takeAppUrl().then((url) => {
          if (url) listener({ url });
        });
      };
      ipcRenderer.on('desktop:app-url', handle);
      return Promise.resolve({
        remove: () => ipcRenderer.removeListener('desktop:app-url', handle),
      });
    },
  },
} satisfies DesktopBridge;

contextBridge.exposeInMainWorld('mindroomDesktop', bridge);
