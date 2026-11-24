import { BrowserWindow, screen } from 'electron';
import type { DesktopAccessShellPending } from '../../src/app/lib/desktopBridge';
import { APP_ORIGIN } from './bundleProtocol';
import { guardWebContents, isShellApprovalUrl } from './security';

const WINDOW_WIDTH = 460;
const WINDOW_HEIGHT = 320;
const EDGE_MARGIN = 20;

export type ShellApprovalWindowOptions = {
  preload: string;
  isQuitting: () => boolean;
  url?: string;
};

export type ShellApprovalWindowHandle = {
  syncPending(pending: DesktopAccessShellPending | null): void;
  notifyStatus(): void;
  hide(): void;
  destroy(): void;
  contents(): Electron.WebContents | undefined;
};

export const createShellApprovalWindow = (
  options: ShellApprovalWindowOptions
): ShellApprovalWindowHandle => {
  const targetUrl = options.url ?? `${APP_ORIGIN}/shell-approval/`;
  let win: BrowserWindow | undefined;
  let ready = false;
  let pendingShow = false;

  const getWindow = (): BrowserWindow | undefined => (win && !win.isDestroyed() ? win : undefined);

  const notifyStatus = (): void => {
    const panel = getWindow();
    if (!panel || panel.webContents.isDestroyed()) return;
    panel.webContents.send('desktop:shell-event', { type: 'desktop-access-status' });
  };

  const presentInactive = (panel: BrowserWindow): void => {
    if (panel.isDestroyed()) return;
    panel.showInactive();
  };

  const hide = (): void => {
    pendingShow = false;
    const panel = getWindow();
    if (!panel) return;
    if (panel.isVisible()) panel.hide();
  };

  const createWindow = (): BrowserWindow => {
    const workArea = screen.getPrimaryDisplay().workArea;
    const x = Math.round(workArea.x + Math.max(0, workArea.width - WINDOW_WIDTH - EDGE_MARGIN));
    const y = Math.round(workArea.y + EDGE_MARGIN);

    const panel = new BrowserWindow({
      x,
      y,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      frame: false,
      backgroundColor: '#1A1A1A',
      show: false,
      webPreferences: {
        preload: options.preload,
        additionalArguments: ['--mindroom-shell-approval=1'],
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
      },
    });
    win = panel;
    ready = false;

    panel.setAlwaysOnTop(true, 'floating');
    panel.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    guardWebContents(panel.webContents, isShellApprovalUrl);

    panel.once('ready-to-show', () => {
      ready = true;
      if (pendingShow && !panel.isDestroyed()) {
        pendingShow = false;
        presentInactive(panel);
      }
    });
    panel.on('close', (event) => {
      if (!options.isQuitting()) {
        event.preventDefault();
        hide();
      }
    });
    panel.on('closed', () => {
      if (win === panel) {
        win = undefined;
        ready = false;
        pendingShow = false;
      }
    });

    void panel.loadURL(targetUrl);
    return panel;
  };

  const showInactive = (): void => {
    const existing = getWindow();
    if (!existing) {
      pendingShow = true;
      createWindow();
      return;
    }
    if (ready) presentInactive(existing);
    else pendingShow = true;
  };

  const syncPending = (pending: DesktopAccessShellPending | null): void => {
    if (pending) {
      showInactive();
      notifyStatus();
    } else {
      hide();
      notifyStatus();
    }
  };

  const destroy = (): void => {
    pendingShow = false;
    const panel = getWindow();
    if (panel) panel.destroy();
    win = undefined;
    ready = false;
  };

  return {
    syncPending,
    notifyStatus,
    hide,
    destroy,
    contents: () => getWindow()?.webContents,
  };
};
