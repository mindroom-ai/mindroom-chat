import type { MatrixClient } from 'matrix-js-sdk';

/**
 * Stops a client the page is done with and closes its sync store. `stopClient` alone leaves the
 * store's IndexedDB connection open, and with it the store's copy of the synced data, for the
 * rest of the page's life: once per account switch or retry.
 *
 * Closing keeps the data. A save that comes after it fails on the closed connection, which the
 * store answers by leaving the database as it is.
 */
export const closeClient = (client: MatrixClient): void => {
  client.stopClient();
  // Optional call: the fake clients of the ported tests have a store without `destroy`.
  Promise.resolve(client.store.destroy?.()).catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[client] could not close the sync store', error);
  });
};
