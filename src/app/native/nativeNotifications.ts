import { Capacitor, registerPlugin } from '@capacitor/core';

/** What the notification extension knows of an account. Nothing of it is secret. */
export type NativeNotificationAccount = {
  accountTag: string;
  userId: string;
};

/** A member's avatar in one room, where it can differ from the member's avatar elsewhere. */
export type NativeNotificationAvatarEntry = {
  roomId: string;
  sender: string;
  mxcUrl: string;
};

/**
 * All the avatars the account has now: the app removes every cached avatar of the account that
 * is not among them.
 */
export type NativeNotificationAvatarSync = {
  accountTag: string;
  avatars: NativeNotificationAvatarEntry[];
};

/** The avatars the app lacks, and the number that `storeNativeNotificationAvatar` must be given. */
export type NativeNotificationAvatarSyncResult = {
  missingMxcUrls: string[];
  syncGeneration: number;
};

/** A downloaded avatar, for every room and sender that show it. */
export type NativeNotificationAvatarStore = {
  accountTag: string;
  syncGeneration: number;
  mxcUrl: string;
  entries: { roomId: string; sender: string }[];
  base64Data: string;
};

/** Plugin `MindRoomNotifications` (ios/App/App/MindRoomNotificationsPlugin.swift). */
type MindRoomNotificationsPlugin = {
  syncAccount(account: NativeNotificationAccount): Promise<void>;
  reconcileAccounts(payload: { allowedAccountTags: string[] }): Promise<void>;
  syncAvatars(payload: NativeNotificationAvatarSync): Promise<NativeNotificationAvatarSyncResult>;
  storeAvatar(payload: NativeNotificationAvatarStore): Promise<void>;
  clearAvatarCache(): Promise<void>;
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

/** The last change of the shared accounts or their avatar cache that was asked for. */
let lastChange: Promise<void> = Promise.resolve();

/**
 * Asks the app for a change (an account shared, the accounts reconciled, the avatar cache
 * cleared) once every change asked for before it is done. A reconcile answers only after it has
 * also deleted what Siri keeps of the accounts it removed, so without this an account shared
 * meanwhile could be stored first and removed by the rest of that reconcile.
 */
const inSubmissionOrder = (change: () => Promise<void>): Promise<void> => {
  const result = lastChange.then(change);
  // A change that failed does not hold up the ones after it.
  lastChange = result.catch(() => undefined);
  return result;
};

/** Shares the account with the notification extension. Rejects when the app could not store it. */
export const syncNativeNotificationAccount = async (
  account: NativeNotificationAccount
): Promise<void> => {
  if (!isNativeNotificationsAvailable()) return;
  await inSubmissionOrder(() => getNotificationsPlugin().syncAccount(account));
};

/**
 * Makes the accounts the app shares with the notification extension none but the ones of
 * `allowedAccountTags`: every other account goes, with its avatars and what Siri keeps of it.
 * Rejects when Siri kept something, which the next call removes.
 */
export const reconcileNativeNotificationAccounts = async (
  allowedAccountTags: string[]
): Promise<void> => {
  if (!isNativeNotificationsAvailable()) return;
  await inSubmissionOrder(() => getNotificationsPlugin().reconcileAccounts({ allowedAccountTags }));
};

/** Lists the account's avatars to the app, which answers with the ones it lacks. */
export const syncNativeNotificationAvatars = async (
  payload: NativeNotificationAvatarSync
): Promise<NativeNotificationAvatarSyncResult> => {
  if (!isNativeNotificationsAvailable()) return { missingMxcUrls: [], syncGeneration: 0 };
  return getNotificationsPlugin().syncAvatars(payload);
};

/** Hands the app an avatar that `syncNativeNotificationAvatars` found missing. */
export const storeNativeNotificationAvatar = async (
  avatar: NativeNotificationAvatarStore
): Promise<void> => {
  if (!isNativeNotificationsAvailable()) return;
  await getNotificationsPlugin().storeAvatar(avatar);
};

/** Removes every avatar the app keeps for notifications. The shared accounts stay. */
export const clearNativeNotificationAvatarCache = async (): Promise<void> => {
  if (!isNativeNotificationsAvailable()) return;
  await inSubmissionOrder(() => getNotificationsPlugin().clearAvatarCache());
};
