import { deletePluginStorageOfAccount } from './pluginStorage';
import { registeredPlugins } from './registry';

/** How long forgetting an account waits for the plugins before the app goes on (and reloads). */
const FORGET_WAIT_MS = 5_000;

/**
 * Deletes every plugin's storage for `userId`, then asks each plugin to forget the account
 * (`forgetAccount`) and waits for them, five seconds at most. The app calls it when this browser
 * deletes the account's local data: on sign-out and account removal, once no other login of the
 * account stays.
 */
export const forgetAccountInPlugins = async (userId: string): Promise<void> => {
  deletePluginStorageOfAccount(userId);
  const forgetting = registeredPlugins.map(async ({ tag, forgetAccount }) => {
    try {
      await forgetAccount?.(userId);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[plugin ${tag}] forgetting an account failed`, error);
    }
  });
  await Promise.race([
    Promise.all(forgetting),
    new Promise((resolve) => {
      setTimeout(resolve, FORGET_WAIT_MS);
    }),
  ]);
};
