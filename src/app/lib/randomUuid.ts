/**
 * A random (version 4) UUID. Browsers offer `crypto.randomUUID` only in secure contexts (HTTPS and
 * localhost), so a client opened over plain HTTP from another device, such as a self-hosted stack
 * at `http://<host-ip>:8080`, builds one from `crypto.getRandomValues`, which every context has.
 */
export const randomUuid = (): string => {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`;
};
