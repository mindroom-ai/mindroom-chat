import { Capacitor, registerPlugin } from '@capacitor/core';

export type NativeNotificationAccount = {
  accountTag: string;
  homeserverUrl: string;
  userId: string;
  accessToken?: string;
};

/** A member's avatar in one room, where it can differ from the member's avatar elsewhere. */
export type NativeNotificationAvatarEntry = {
  roomId: string;
  sender: string;
  mxcUrl: string;
};

/**
 * All the avatars the account has now: the app removes every cached avatar of the account that
 * is not among them, and downloads the ones it lacks.
 */
export type NativeNotificationAvatarSync = {
  accountTag: string;
  avatars: NativeNotificationAvatarEntry[];
};

/** Plugin `MindRoomNotifications` (ios/App/App/MindRoomNotificationsPlugin.swift). */
type MindRoomNotificationsPlugin = {
  syncAccount(account: NativeNotificationAccount): Promise<void>;
  syncAvatars(payload: NativeNotificationAvatarSync): Promise<void>;
  clearAccount(payload: { accountTag: string }): Promise<void>;
  clearAllAccounts(): Promise<void>;
};

let notificationsPlugin: MindRoomNotificationsPlugin | undefined;

const getNotificationsPlugin = (): MindRoomNotificationsPlugin => {
  notificationsPlugin ??= registerPlugin<MindRoomNotificationsPlugin>('MindRoomNotifications');
  return notificationsPlugin;
};

export const isNativeNotificationsAvailable = (): boolean =>
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'ios' &&
  Capacitor.isPluginAvailable('MindRoomNotifications');

/** The last change of an account that the app was asked for, settled or not. */
let lastAccountChange: Promise<void> = Promise.resolve();

/**
 * Asks the app for a change of the accounts it shares (a sync, a clear, a clear of all) once
 * every change asked for before it is done. A clear answers only after it has also deleted what
 * Siri keeps of the account, so without this a sync asked for meanwhile would be stored first and
 * removed by the rest of that clear.
 */
const inSubmissionOrder = (change: () => Promise<void>): Promise<void> => {
  const result = lastAccountChange.then(change);
  // A change that failed does not hold up the ones after it.
  lastAccountChange = result.catch(() => undefined);
  return result;
};

export const syncNativeNotificationAccount = async (
  account: NativeNotificationAccount
): Promise<void> => {
  if (!isNativeNotificationsAvailable()) return;
  await inSubmissionOrder(() => getNotificationsPlugin().syncAccount(account));
};

export const syncNativeNotificationAvatars = async (
  payload: NativeNotificationAvatarSync
): Promise<void> => {
  if (!isNativeNotificationsAvailable()) return;
  await getNotificationsPlugin().syncAvatars(payload);
};

export const clearNativeNotificationAccount = async (accountTag: string): Promise<void> => {
  if (!isNativeNotificationsAvailable()) return;
  const trimmed = accountTag.trim();
  if (!trimmed) return;
  await inSubmissionOrder(() => getNotificationsPlugin().clearAccount({ accountTag: trimmed }));
};

/** Removes what every account on the device shares with the notification extension. */
export const clearAllNativeNotificationAccounts = async (): Promise<void> => {
  if (!isNativeNotificationsAvailable()) return;
  await inSubmissionOrder(() => getNotificationsPlugin().clearAllAccounts());
};
