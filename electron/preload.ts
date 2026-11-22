import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, DesktopShellEvent } from '../src/app/lib/desktopBridge';

const externalUrlForClick = (event: MouseEvent): string | undefined => {
  if (!event.isTrusted || (event.type === 'click' ? event.button !== 0 : event.button !== 1)) {
    return undefined;
  }
  const el =
    event.target instanceof Element
      ? event.target
      : event.target instanceof Node
      ? event.target.parentElement
      : null;
  const hit = el?.closest('a[href], button[data-open-external]');
  if (hit instanceof HTMLButtonElement) {
    return event.type === 'click' && !hit.disabled
      ? hit.getAttribute('data-open-external') || undefined
      : undefined;
  }
  if (!(hit instanceof HTMLAnchorElement)) return undefined;
  try {
    const parsed = new URL(hit.href);
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
} satisfies DesktopBridge;

contextBridge.exposeInMainWorld('mindroomDesktop', bridge);
