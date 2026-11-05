// @ts-check
/**
 * In-memory cache of secret storage (4S) private keys for the running session, so entering a
 * recovery key once unlocks every secret the crypto stack asks for. The cache is never
 * persisted; logout and account switches clear it with `clearSecretStorageKeys`.
 */

/** @type {Map<string, Uint8Array>} */
const privateKeys = new Map();

/**
 * Remembers the private key for a secret storage key ID.
 * @param {string} keyId
 * @param {Uint8Array} privateKey
 */
export function storePrivateKey(keyId, privateKey) {
  if (!(privateKey instanceof Uint8Array))
    throw new Error('Secret storage key must be a Uint8Array');
  privateKeys.set(keyId, privateKey);
}

/** Forgets every cached key: call at an account boundary (logout, switch, cache clear). */
export function clearSecretStorageKeys() {
  privateKeys.clear();
}

/**
 * Crypto callbacks for `createClient`: answers secret storage key requests from the cache and
 * caches keys the crypto stack creates or derives. No cached key resolves `undefined`, which the
 * SDK treats as "no key".
 */
export const cryptoCallbacks = {
  /**
   * @param {{ keys: Record<string, unknown> }} request the key IDs the secret may be read with
   * @returns {Promise<[string, Uint8Array] | undefined>}
   */
  async getSecretStorageKey({ keys }) {
    const keyId = Object.keys(keys).find((id) => privateKeys.has(id));
    const privateKey = keyId ? privateKeys.get(keyId) : undefined;
    return keyId && privateKey ? [keyId, privateKey] : undefined;
  },
  /**
   * @param {string} keyId
   * @param {unknown} _keyInfo
   * @param {Uint8Array} privateKey
   */
  cacheSecretStorageKey(keyId, _keyInfo, privateKey) {
    storePrivateKey(keyId, privateKey);
  },
};
