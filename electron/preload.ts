import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, DesktopShellEvent } from '../src/app/lib/desktopBridge';

const isEditable = (path: EventTarget[], from: number): boolean => {
  for (let i = from; i < path.length; i += 1) {
    const node = path[i];
    if (node instanceof HTMLElement) return node.isContentEditable;
  }
  return false;
};

const externalUrlForClick = (event: MouseEvent): string | undefined => {
  if (!event.isTrusted || (event.type === 'click' ? event.button !== 0 : event.button !== 1)) {
    return undefined;
  }
  const path = event.composedPath();
  const idx = path.findIndex(
    (node) => node instanceof Element && node.matches('a[href], button[data-open-external]')
  );
  if (idx < 0 || isEditable(path, idx)) return undefined;
  const hit = path[idx] as Element;
  if (hit instanceof HTMLButtonElement) {
    return event.type === 'click' && !hit.disabled
      ? hit.getAttribute('data-open-external') || undefined
      : undefined;
  }
  const rawHref =
    hit instanceof HTMLAnchorElement
      ? hit.href
      : hit instanceof SVGAElement
      ? hit.href.baseVal
      : undefined;
  if (!rawHref) return undefined;
  try {
    const parsed = new URL(rawHref, window.location.href);
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
