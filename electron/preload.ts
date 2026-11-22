import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, DesktopShellEvent } from '../src/app/lib/desktopBridge';

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
} satisfies DesktopBridge;

contextBridge.exposeInMainWorld('mindroomDesktop', bridge);
