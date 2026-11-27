import { Capacitor, registerPlugin } from '@capacitor/core';
import { isNativeAndroid } from './nativeSso';

type MindRoomCallPlugin = {
  start(options?: { roomName?: string }): Promise<{ active?: boolean }>;
  stop(): Promise<void>;
};

let mindRoomCallPlugin: MindRoomCallPlugin | undefined;

const getMindRoomCallPlugin = (): MindRoomCallPlugin => {
  mindRoomCallPlugin ??= registerPlugin<MindRoomCallPlugin>('MindRoomCall');
  return mindRoomCallPlugin;
};

/** Whether the Android call foreground service plugin is available on this device. */
export const isAndroidCallServiceAvailable = (): boolean =>
  isNativeAndroid() && Capacitor.isPluginAvailable('MindRoomCall');

/** Starts or updates the Android active-call foreground service; swallows native errors. */
export const startAndroidCallService = async (roomName?: string): Promise<boolean> => {
  if (!isAndroidCallServiceAvailable()) return false;
  try {
    const result = await getMindRoomCallPlugin().start(roomName ? { roomName } : {});
    return result?.active === true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[android-call] could not start call foreground service', error);
    return false;
  }
};

/** Stops the Android active-call foreground service idempotently; swallows native errors. */
export const stopAndroidCallService = async (): Promise<void> => {
  if (!isAndroidCallServiceAvailable()) return;
  try {
    await getMindRoomCallPlugin().stop();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[android-call] could not stop call foreground service', error);
  }
};
