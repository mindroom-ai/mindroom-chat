import { Menu, Tray, nativeImage } from 'electron';
import type { DesktopAccessSnapshot } from '../../src/app/lib/desktopBridge';

// 16x16 monochrome monitor silhouette PNG (opaque black on transparent for macOS template rendering).
const TRAY_ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAANElEQVR42mNgGEzgP4kYq2ZSLUMRIMfFeA3A6+ShYQDJYUBRLFCcDhjICAOyUiVVkvQgAwBLsEe5PI+g7gAAAABJRU5ErkJggg==';

export type DesktopAccessTrayCallbacks = {
  onRevokeAll: () => void;
  onOpenMainWindow: () => void;
  onOpenSettings: () => void;
};

export type DesktopAccessTrayHandle = {
  sync(snapshot: DesktopAccessSnapshot): void;
  destroy(): void;
};

const isBridgeActive = (snapshot: DesktopAccessSnapshot): boolean => {
  const state = snapshot.status?.bridge.state;
  return state === 'observe_only' || state === 'control' || state === 'stopping';
};

const fullAccessAgentNames = (snapshot: DesktopAccessSnapshot): string[] => {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (name: string | undefined): void => {
    const trimmed = name?.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    names.push(trimmed);
  };
  const controllers = snapshot.status?.config.controllers ?? [];
  for (const [key, consent] of Object.entries(snapshot.consent)) {
    if (consent.mode !== 'full') continue;
    if (consent.agentName) {
      add(consent.agentName);
      continue;
    }
    const matched = controllers.find((c) => c.controller_key === key);
    if (matched) {
      for (const agent of matched.allowed_agent_names) add(agent);
    }
  }
  return names;
};

export const formatTrayStatusLabel = (snapshot: DesktopAccessSnapshot): string => {
  const consentedKeys = Object.keys(snapshot.consent);
  if (consentedKeys.length > 0) {
    const names = fullAccessAgentNames(snapshot);
    return names.length > 0
      ? `MindRoom · Full Access (${names.join(', ')})`
      : 'MindRoom · Full Access';
  }
  return 'MindRoom · Active';
};

export const createDesktopAccessTray = (
  callbacks: DesktopAccessTrayCallbacks,
  options?: { enabled?: boolean }
): DesktopAccessTrayHandle => {
  const enabled = options?.enabled ?? process.platform === 'darwin';
  let tray: Tray | undefined;

  const destroy = (): void => {
    if (tray && !tray.isDestroyed()) {
      tray.destroy();
    }
    tray = undefined;
  };

  const ensureTray = (): Tray => {
    if (tray && !tray.isDestroyed()) return tray;
    const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG_BASE64, 'base64'));
    icon.setTemplateImage(true);
    tray = new Tray(icon);
    return tray;
  };

  const sync = (snapshot: DesktopAccessSnapshot): void => {
    if (!enabled) return;
    const active = isBridgeActive(snapshot) || Object.keys(snapshot.consent).length > 0;
    if (!active) {
      destroy();
      return;
    }
    const instance = ensureTray();
    const statusLabel = formatTrayStatusLabel(snapshot);
    instance.setToolTip(statusLabel);
    const menu = Menu.buildFromTemplate([
      { label: statusLabel, enabled: false },
      { label: 'Revoke All Access', click: callbacks.onRevokeAll },
      { type: 'separator' },
      { label: 'Open MindRoom Chat', click: callbacks.onOpenMainWindow },
      { label: 'Computer Access Settings...', click: callbacks.onOpenSettings },
    ]);
    instance.setContextMenu(menu);
  };

  return { sync, destroy };
};
