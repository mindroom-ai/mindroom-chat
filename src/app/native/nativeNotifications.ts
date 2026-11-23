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
  mxcUrl: string | null;
};

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

export const syncNativeNotificationAccount = async (
  account: NativeNotificationAccount
): Promise<void> => {
  if (!isNativeNotificationsAvailable()) return;
  await getNotificationsPlugin().syncAccount(account);
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
  await getNotificationsPlugin().clearAccount({ accountTag: trimmed });
};

/** Removes what every account on the device shares with the notification extension. */
export const clearAllNativeNotificationAccounts = async (): Promise<void> => {
  if (!isNativeNotificationsAvailable()) return;
  await getNotificationsPlugin().clearAllAccounts();
};
