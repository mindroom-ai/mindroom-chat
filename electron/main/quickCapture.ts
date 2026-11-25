import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, screen } from 'electron';
import type { FrontTargetLookup } from './helper';
import { attachContextMenu } from './mainWindow';
import { guardWebContents, isQuickCaptureUrl } from './security';
import {
  WIDGET_HEIGHT,
  WIDGET_WIDTH,
  fitQuickCaptureToDisplays,
  loadQuickCapturePlace,
  saveQuickCapturePlace,
} from './windowState';

const SAVE_DEBOUNCE_MS = 250;

export type QuickCaptureToggleAction = 'show' | 'hide' | 'focus';

export const decideToggleAction = (state: {
  visible: boolean;
  focused: boolean;
}): QuickCaptureToggleAction => {
  if (!state.visible) return 'show';
  return state.focused ? 'hide' : 'focus';
};

export type QuickCaptureOptions = {
  url: string;
  preload: string;
  userDataDir: string;
  isQuitting: () => boolean;
  isMainWindowVisible: () => boolean;
  screenshotHelper?: {
    available: boolean;
    readFrontTarget(): Promise<FrontTargetLookup>;
  };
};

export type QuickCaptureHandle = {
  toggle(): void;
  hide(): void;
  contents(): Electron.WebContents | undefined;
  flushState(): void;
  frontTarget(): FrontTargetLookup;
  displayId(): number | undefined;
};

export const createQuickCapture = (options: QuickCaptureOptions): QuickCaptureHandle => {
  let win: BrowserWindow | undefined;
  let ready = false;
  let pendingShow = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let lastFrontTarget: FrontTargetLookup;
  let toggleSeq = 0;

  const getWindow = (): BrowserWindow | undefined => (win && !win.isDestroyed() ? win : undefined);

  const clearSaveTimer = (): void => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  };

  const flushState = (): void => {
    clearSaveTimer();
    const panel = getWindow();
    if (!panel) return;
    const { x, y } = panel.getBounds();
    saveQuickCapturePlace(options.userDataDir, { x, y });
  };

  const scheduleSave = (): void => {
    clearSaveTimer();
    saveTimer = setTimeout(flushState, SAVE_DEBOUNCE_MS);
  };

  const present = (panel: BrowserWindow): void => {
    if (panel.isDestroyed()) return;
    panel.show();
    panel.focus();
  };

  const hide = (): void => {
    toggleSeq += 1;
    pendingShow = false;
    const panel = getWindow();
    if (!panel) return;
    const wasVisible = panel.isVisible();
    panel.hide();
    if (wasVisible && process.platform === 'darwin' && !options.isMainWindowVisible()) {
      app.hide();
    }
  };

  const createWindow = (): BrowserWindow => {
    const restored = fitQuickCaptureToDisplays(
      loadQuickCapturePlace(options.userDataDir),
      screen.getAllDisplays().map((display) => display.workArea)
    );
    const isDarwin = process.platform === 'darwin';
    const iconPath = path.join(__dirname, 'icon.png');
    const panel = new BrowserWindow({
      ...(restored ? { x: restored.x, y: restored.y } : {}),
      width: WIDGET_WIDTH,
      height: WIDGET_HEIGHT,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      frame: false,
      hasShadow: true,
      show: false,
      alwaysOnTop: true,
      ...(isDarwin
        ? { transparent: true, type: 'panel', vibrancy: 'popover' as const }
        : {
            transparent: false,
            backgroundColor: '#1A1A1A',
            ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
          }),
      webPreferences: {
        preload: options.preload,
        additionalArguments: [
          '--mindroom-quick-capture=1',
          ...(isDarwin ? ['--mindroom-quick-capture-vibrancy=1'] : []),
          ...(options.screenshotHelper?.available ? ['--mindroom-screenshot-helper=1'] : []),
        ],
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
    guardWebContents(panel.webContents, isQuickCaptureUrl);
    attachContextMenu(panel);

    panel.once('ready-to-show', () => {
      ready = true;
      if (pendingShow && !panel.isDestroyed()) {
        pendingShow = false;
        present(panel);
      }
    });
    panel.on('move', scheduleSave);
    panel.on('hide', flushState);
    panel.on('close', (event) => {
      if (!options.isQuitting()) {
        event.preventDefault();
        hide();
      } else {
        flushState();
      }
    });
    panel.on('closed', () => {
      clearSaveTimer();
      if (win === panel) {
        win = undefined;
        ready = false;
        pendingShow = false;
      }
    });

    void panel.loadURL(options.url);
    return panel;
  };

  const showOrCreate = (): void => {
    const existing = getWindow();
    if (!existing) {
      pendingShow = true;
      createWindow();
      return;
    }
    if (ready) present(existing);
    else pendingShow = true;
  };

  const toggle = (): void => {
    const existing = getWindow();
    if (existing) {
      const action = decideToggleAction({
        visible: existing.isVisible(),
        focused: existing.isFocused(),
      });
      if (action === 'hide') {
        hide();
        return;
      }
    }
    const helper = options.screenshotHelper;
    if (!helper?.available) {
      showOrCreate();
      return;
    }
    const seq = ++toggleSeq;
    void helper
      .readFrontTarget()
      .catch(() => 'FAILED' as const)
      .then((target) => {
        if (seq !== toggleSeq) return;
        lastFrontTarget = target;
        showOrCreate();
      });
  };

  const displayId = (): number | undefined => {
    const panel = getWindow();
    return panel ? screen.getDisplayMatching(panel.getBounds()).id : undefined;
  };

  return {
    toggle,
    hide,
    contents: () => getWindow()?.webContents,
    flushState,
    frontTarget: () => lastFrontTarget,
    displayId,
  };
};
