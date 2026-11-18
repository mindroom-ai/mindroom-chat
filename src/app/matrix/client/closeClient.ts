import type { MatrixClient } from 'matrix-js-sdk';

const closers = new WeakMap<MatrixClient, Array<() => void>>();

/**
 * Has `stop` called when the page is done with the client (`closeClient`): for a listener outside
 * the client that reaches it, which would keep the client in memory and act on it after that.
 */
export const onClientClose = (client: MatrixClient, stop: () => void): void => {
  closers.set(client, [...(closers.get(client) ?? []), stop]);
};

/**
 * Stops a client the page is done with and closes its sync store. `stopClient` alone leaves the
 * store's IndexedDB connection open, and with it the store's copy of the synced data, for the
 * rest of the page's life: once per account switch or retry. First it stops what listens to the
 * client from outside it (`onClientClose`).
 *
 * Closing keeps the data. A save that comes after it fails on the closed connection, which the
 * store answers by leaving the database as it is.
 */
export const closeClient = (client: MatrixClient): void => {
  closers.get(client)?.forEach((stop) => stop());
  closers.delete(client);
  client.stopClient();
  // Optional call: the fake clients of some tests have a store without `destroy`.
  Promise.resolve(client.store.destroy?.()).catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[client] could not close the sync store', error);
  });
};
