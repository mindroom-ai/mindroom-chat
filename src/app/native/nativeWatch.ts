import { Capacitor, registerPlugin } from '@capacitor/core';

/** What the iPhone sends the watch over WatchConnectivity: a one-time login for its own device. */
export type WatchCredentials = {
  v: 1;
  kind: 'credentials';
  homeserverUrl: string;
  userId: string;
  loginToken: string;
  /** Milliseconds since the epoch; the watch ignores the token after it. */
  expiresAt: number;
};

/**
 * The account's secrets bundle (private cross-signing keys, the key backup's key) as JSON: importing it
 * verifies the watch's device and turns key backup on, as a QR code sign-in does for a new device.
 */
export type WatchSecrets = { v: 1; kind: 'secrets'; userId: string; bundle: string };

/** The watch's own Matrix device, once it signed in. */
export type WatchDevice = { userId: string; deviceId: string };

/** A thread the watch handed off to the iPhone (Handoff from the watch's thread screen). */
export type WatchThread = { roomId: string; threadId: string };

export type WatchStatus = {
  /** An Apple Watch is paired with this iPhone. */
  paired: boolean;
  /** MindRoom is installed on it. */
  installed: boolean;
  /** The watch app runs and can answer now. */
  reachable: boolean;
  /** The device the watch last said it signed in as, until Disconnect. */
  device?: WatchDevice;
};

/** Plugin `MindRoomWatch` (ios/App/App/MindRoomWatchPlugin.swift). */
type MindRoomWatchPlugin = {
  status(): Promise<WatchStatus>;
  sendCredentials(credentials: WatchCredentials): Promise<void>;
  sendSecrets(secrets: WatchSecrets): Promise<void>;
  signOut(): Promise<void>;
  addListener(
    event: 'watchSignedIn',
    callback: (device: WatchDevice) => void
  ): Promise<{ remove: () => void }>;
  addListener(
    event: 'openThread',
    callback: (thread: WatchThread) => void
  ): Promise<{ remove: () => void }>;
};

let watchPlugin: MindRoomWatchPlugin | undefined;

const getWatchPlugin = (): MindRoomWatchPlugin => {
  watchPlugin ??= registerPlugin<MindRoomWatchPlugin>('MindRoomWatch');
  return watchPlugin;
};

export const isNativeWatchAvailable = (): boolean =>
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'ios' &&
  Capacitor.isPluginAvailable('MindRoomWatch');

export const getWatchStatus = async (): Promise<WatchStatus> =>
  isNativeWatchAvailable()
    ? getWatchPlugin().status()
    : { paired: false, installed: false, reachable: false };

export const sendWatchCredentials = async (credentials: WatchCredentials): Promise<void> => {
  if (!isNativeWatchAvailable()) return;
  await getWatchPlugin().sendCredentials(credentials);
};

export const sendWatchSecrets = async (secrets: WatchSecrets): Promise<void> => {
  if (!isNativeWatchAvailable()) return;
  await getWatchPlugin().sendSecrets(secrets);
};

/** Tells the watch to sign out and forgets its device here. */
export const signOutWatch = async (): Promise<void> => {
  if (!isNativeWatchAvailable()) return;
  await getWatchPlugin().signOut();
};

/** Calls `listener` when the watch reports its new device; the returned function stops it. */
export const onWatchSignedIn = async (
  listener: (device: WatchDevice) => void
): Promise<() => void> => {
  if (!isNativeWatchAvailable()) return () => undefined;
  const handle = await getWatchPlugin().addListener('watchSignedIn', listener);
  return () => handle.remove();
};

/** Calls `listener` with each thread the watch hands off; the returned function stops it. */
export const onWatchOpenThread = async (
  listener: (thread: WatchThread) => void
): Promise<() => void> => {
  if (!isNativeWatchAvailable()) return () => undefined;
  const handle = await getWatchPlugin().addListener('openThread', listener);
  return () => handle.remove();
};
