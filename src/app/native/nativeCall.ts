import { Capacitor, registerPlugin } from '@capacitor/core';
import { isMacOS } from '../lib/user-agent';
import { isNativeIOS } from './nativeSso';

export type NativeCallSnapshot = {
  state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  local: { speaking: boolean; microphone: boolean };
  participants: Array<{ identity: string; speaking: boolean; microphone: boolean }>;
};

export type MindRoomCallPlugin = {
  connect(options: {
    nonce: string;
    url: string;
    token: string;
    encrypted: boolean;
  }): Promise<{ id: string }>;
  setKey(options: {
    id: string;
    identity: string;
    index: number;
    key: string;
    own: boolean;
  }): Promise<void>;
  setMembers(options: { id: string; identities: string[] }): Promise<void>;
  setSound(options: { id: string; on: boolean }): Promise<void>;
  setMicrophone(options: { id: string; on: boolean }): Promise<void>;
  snapshot(options: { id: string }): Promise<NativeCallSnapshot>;
  disconnect(options: { id: string }): Promise<void>;
};

let callPlugin: MindRoomCallPlugin | undefined;

/** `registerPlugin<MindRoomCallPlugin>('MindRoomCall')`, once. */
export const getNativeCallPlugin = (): MindRoomCallPlugin => {
  if (!callPlugin) {
    callPlugin = registerPlugin<MindRoomCallPlugin>('MindRoomCall');
  }
  return callPlugin;
};

/** `isNativeIOS() && Capacitor.isPluginAvailable('MindRoomCall')`. */
export const isNativeCallAvailable = (): boolean =>
  isNativeIOS() && Capacitor.isPluginAvailable('MindRoomCall');

/** The Mac app is the iOS app under Mac Catalyst: `isNativeIOS() && isMacOS()`. */
export const isMacApp = (): boolean => isNativeIOS() && isMacOS();

/** The `code` of a plugin rejection, undefined for anything else. */
export const nativeCallErrorCode = (error: unknown): string | undefined => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error;
    if (typeof code === 'string') return code;
  }
  return undefined;
};
