import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, DesktopShellEvent } from '../src/app/lib/desktopBridge';

const isShellEvent = (v: unknown): v is DesktopShellEvent =>
  typeof v === 'object' &&
  v !== null &&
  (v as { type?: unknown }).type === 'fullscreen' &&
  typeof (v as { value?: unknown }).value === 'boolean';

const bridge = {
  onShellEvent: (listener: (event: DesktopShellEvent) => void): (() => void) => {
    const handle = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (isShellEvent(payload)) listener(payload);
    };
    ipcRenderer.on('desktop:shell-event', handle);
    return () => {
      ipcRenderer.removeListener('desktop:shell-event', handle);
    };
  },
} satisfies DesktopBridge;

contextBridge.exposeInMainWorld('mindroomDesktop', bridge);
