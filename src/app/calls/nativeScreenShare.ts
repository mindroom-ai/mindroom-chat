import { Capacitor, registerPlugin } from '@capacitor/core';

/** Localized strings displayed in the native iOS ReplayKit broadcast picker sheet. */
export type NativeScreenShareSheetStrings = {
  title: string;
  body: string;
  caption: string;
  cancel: string;
};

/** Start payload sent to `MindRoomScreenSharePlugin.start` on iOS. */
export type NativeScreenShareStartOptions = {
  url: string;
  token: string;
  identity: string;
  encrypted: boolean;
  keyBase64?: string;
  keyIndex?: number;
  allowedIdentities: string[];
  leaseMs?: number;
  strings?: NativeScreenShareSheetStrings;
};

/** Lifecycle event emitted by `MindRoomScreenSharePlugin`. */
export type NativeScreenShareStateEvent = {
  generation: number;
  state: 'broadcasting' | 'stopped';
  reason?: string;
  detail?: string;
};

/** Status returned by `MindRoomScreenSharePlugin.heartbeat`. */
export type NativeScreenShareHeartbeatResult = {
  broadcasting: boolean;
  connected: boolean;
  keyIndex: number;
};

/** Plugin `MindRoomScreenShare` (`ios/App/App/MindRoomScreenSharePlugin.swift`). */
export type NativeScreenSharePlugin = {
  start(options: NativeScreenShareStartOptions): Promise<{ generation: number }>;
  setKey(options: { generation: number; keyBase64: string; keyIndex: number }): Promise<void>;
  updateAllowedParticipants(options: { generation: number; identities: string[] }): Promise<void>;
  heartbeat(options: { generation: number }): Promise<NativeScreenShareHeartbeatResult>;
  stop(): Promise<void>;
  addListener(
    event: 'stateChange',
    callback: (event: NativeScreenShareStateEvent) => void
  ): Promise<{ remove: () => void | Promise<void> }>;
};

let plugin: NativeScreenSharePlugin | undefined;

const getPlugin = (): NativeScreenSharePlugin => {
  plugin ??= registerPlugin<NativeScreenSharePlugin>('MindRoomScreenShare');
  return plugin;
};

/** Whether the iOS native whole-phone screen-share plugin is available in this runtime. */
export const isNativeScreenShareAvailable = (): boolean =>
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'ios' &&
  Capacitor.isPluginAvailable('MindRoomScreenShare');

/** Thin Capacitor bridge for the native publish-only ReplayKit LiveKit room. */
export const nativeScreenShare: NativeScreenSharePlugin = {
  start: (options) => getPlugin().start(options),
  setKey: (options) => getPlugin().setKey(options),
  updateAllowedParticipants: (options) => getPlugin().updateAllowedParticipants(options),
  heartbeat: (options) => getPlugin().heartbeat(options),
  stop: () => getPlugin().stop(),
  addListener: (event, callback) => getPlugin().addListener(event, callback),
};