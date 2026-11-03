// @ts-check
/**
 * In-memory cache of secret storage (4S) private keys for the running session, so entering a
 * recovery key once unlocks every secret the crypto stack asks for. The cache is never
 * persisted; logout and account switches clear it with `clearSecretStorageKeys`.
 */

/** @type {Map<string, Uint8Array>} */
const secretStorageKeys = new Map();

/**
 * Remembers the private key for a secret storage key ID.
 * @param {string} keyId
 * @param {Uint8Array} privateKey
 */
export function storePrivateKey(keyId, privateKey) {
  if (!(privateKey instanceof Uint8Array))
    throw new Error('Secret storage key must be a Uint8Array');
  secretStorageKeys.set(keyId, privateKey);
}

/**
 * @param {string} keyId
 * @returns {boolean}
 */
export function hasPrivateKey(keyId) {
  return secretStorageKeys.has(keyId);
}

/**
 * @param {string} keyId
 * @returns {Uint8Array | undefined}
 */















  async getSecretStorageKey({ keys }) {
    const keyId = Object.keys(keys).find((id) => secretStorageKeys.has(id));
    if (!keyId) return /** @type {null} */ (/** @type {unknown} */ (undefined));
    return [keyId, /** @type {Uint8Array} */ (secretStorageKeys.get(keyId))];
  },
  cacheSecretStorageKey(keyId, _keyInfo, privateKey) {
    storePrivateKey(keyId, privateKey);
  },
};
