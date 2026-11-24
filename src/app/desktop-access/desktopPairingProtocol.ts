/**
 * Wire formats of Mac Computer Access pairing. The six agent events and the controller key mirror
 * the MindRoom backend (`src/mindroom/desktop/protocol.py`, `command_journal.py`); the three relay
 * events and the account data travel only between this account's own Chat devices.
 */
import { isRecord } from '../lib/isRecord';
import { sha256 } from './sha256';

export const DESKTOP_SETUP_REQUEST_EVENT = 'io.mindroom.desktop.setup_request.v1';
export const DESKTOP_SETUP_OFFER_EVENT = 'io.mindroom.desktop.setup_offer.v1';
export const DESKTOP_PAIRING_CONFIRM_EVENT = 'io.mindroom.desktop.pairing_confirm.v1';
export const DESKTOP_PAIRING_CONFIRMED_EVENT = 'io.mindroom.desktop.pairing_confirmed.v1';
export const DESKTOP_DISCONNECT_REQUEST_EVENT = 'io.mindroom.desktop.disconnect_request.v1';
export const DESKTOP_DISCONNECT_CONFIRMED_EVENT = 'io.mindroom.desktop.disconnect_confirmed.v1';
export const DESKTOP_MAC_DEVICES_ACCOUNT_DATA = 'io.mindroom.desktop.mac_devices';
export const DESKTOP_PAIR_INVITE_EVENT = 'io.mindroom.desktop.pair_invite.v1';
export const DESKTOP_PAIR_INVITE_RESULT_EVENT = 'io.mindroom.desktop.pair_invite_result.v1';
export const DESKTOP_PAIR_INVITE_CONFIRMED_EVENT = 'io.mindroom.desktop.pair_invite_confirmed.v1';

/** One Matrix device pinned by its signing key, as the helper stores its controllers. */
export type PinnedDevice = { user_id: string; device_id: string; ed25519: string };
type Failed = { ok: false; error: string };

export type DesktopAgentRequest = { v: 1; nonce: string; agent_name: string };
export type DesktopSetupOffer = { v: 1; nonce: string; agent_name: string } & (
  | { eligible: true; homeserver: string; user_id: string; code: string; error: null }
  | {
      eligible: false;
      homeserver: string | null;
      user_id: string | null;
      code: null;
      error: string;
    }
) & { cloudflare_access: boolean };
export type DesktopPairingConfirm = {
  v: 1;
  nonce: string;
  token: string;
  verification: string;
  device_id: string;
  device_ed25519: string;
};
export type DesktopAgentStatus = DesktopAgentRequest & ({ ok: true; error: null } | Failed);
export type MacDeviceEntry = { device_id: string; label: string; updated_at: number };
export type MacDevicesAccountData = { v: 1; devices: MacDeviceEntry[] };
export type DesktopPairInvite = DesktopAgentRequest & {
  agent_user_id: string;
  controller: PinnedDevice;
  homeserver: string;
  user_id: string;
  code: string;
  cloudflare_access: boolean;
  requester_label: string;
  sas_code: string;
};
type Claimed = { device_id: string; device_ed25519: string; verification: string };
export type DesktopPairInviteResult = { v: 1; nonce: string } & (
  ({ ok: true; error: null } & Claimed) | Failed
);
export type DesktopPairInviteConfirmed = { v: 1; nonce: string } & (
  { ok: true; error: null } | Failed
);

type Fields = Record<string, unknown>;

/** The object of a version 1 event, or null. */
const fields = (raw: unknown): Fields | null => (isRecord(raw) && raw.v === 1 ? raw : null);

/** The named fields as non-blank strings within their length limits, or null if one is not. */
const strings = <K extends string>(
  content: unknown,
  limits: Record<K, number>
): Record<K, string> | null => {
  if (!isRecord(content)) return null;
  const found = {} as Record<K, string>;
  for (const key of Object.keys(limits) as K[]) {
    const value = content[key];
    if (typeof value !== 'string' || !value.trim() || value.length > limits[key]) return null;
    found[key] = value;
  }
  return found;
};

/** A plain https URL, or http on this computer: nothing may disguise the host the helper signs in to. */
const isSetupHomeserver = (url: string): boolean => {
  const authority = /^https?:\/\/([^/?#]*)/i.exec(url)?.[1];
  if (authority === undefined || authority.includes('@') || !/^[\x21-\x7e]+$/.test(url))
    return false;
  try {
    const { protocol, hostname } = new URL(url);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
    return hostname !== '' && (protocol === 'https:' || (protocol === 'http:' && local));
  } catch {
    return false;
  }
};

/** The optional `cloudflare_access` flag: false when absent, null when not a boolean. */
const cloudflareOf = ({ cloudflare_access: flag = false }: Fields): boolean | null =>
  typeof flag === 'boolean' ? flag : null;

/** `{ ok, error }` where a success carries no error and a failure carries one; null if broken. */
const outcome = ({ ok, error }: Fields): { ok: true; error: null } | Failed | null => {
  if (typeof ok !== 'boolean') return null;
  if (error === undefined || error === null) return ok ? { ok, error: null } : null;
  return !ok && strings({ error }, { error: 1024 }) ? { ok, error: error as string } : null;
};

/** The nonce of a version 1 event: 16 to 128 characters without whitespace, as the backend takes. */
const nonceOf = (raw: unknown): string | null => {
  const nonce = fields(raw) && strings(raw, { nonce: 128 })?.nonce;
  return nonce && nonce.length >= 16 && !/\s/.test(nonce) ? nonce : null;
};

const parseAgentRequest = (raw: unknown): DesktopAgentRequest | null => {
  const nonce = nonceOf(raw);
  const named = strings(raw, { agent_name: 128 });
  return nonce && named ? { v: 1, nonce, ...named } : null;
};

const parseAgentStatus = (raw: unknown): DesktopAgentStatus | null => {
  const request = parseAgentRequest(raw);
  const result = request && outcome(raw as Fields);
  return request && result ? { ...request, ...result } : null;
};

export const parseDesktopSetupRequest = parseAgentRequest;
export const parseDesktopDisconnectRequest = parseAgentRequest;
export const parseDesktopPairingConfirmed = parseAgentStatus;
export const parseDesktopDisconnectConfirmed = parseAgentStatus;

export const parseDesktopSetupOffer = (raw: unknown): DesktopSetupOffer | null => {
  const request = parseAgentRequest(raw);
  const content = raw as Fields;
  const cloudflare = request && cloudflareOf(content);
  if (!request || cloudflare === null) return null;
  const base = { ...request, cloudflare_access: cloudflare };
  if (content.eligible === true) {
    // An eligible offer names where the helper signs in, as whom, and its one-time code.
    const target = strings(content, { homeserver: 2048, user_id: 512, code: 256 });
    if (!target || !isSetupHomeserver(target.homeserver) || content.error != null) return null;
    return { ...base, eligible: true, ...target, error: null };
  }
  const failure = strings(content, { error: 1024 });
  if (content.eligible !== false || !failure || content.code != null) return null;
  const optional = (key: 'homeserver' | 'user_id', max: number): string | null | undefined =>
    content[key] == null ? null : strings(content, { [key]: max })?.[key];
  const homeserver = optional('homeserver', 2048);
  const userId = optional('user_id', 512);
  if (homeserver === undefined || userId === undefined) return null;
  if (homeserver !== null && !isSetupHomeserver(homeserver)) return null;
  return { ...base, ...failure, eligible: false, homeserver, user_id: userId, code: null };
};

const CLAIMED = { device_id: 256, device_ed25519: 256, verification: 64 };

export const parseDesktopPairingConfirm = (raw: unknown): DesktopPairingConfirm | null => {
  const nonce = nonceOf(raw);
  const found = strings(raw, { token: 256, ...CLAIMED });
  return nonce && found ? { v: 1, nonce, ...found } : null;
};

export const parseMacDevicesAccountData = (raw: unknown): MacDevicesAccountData | null => {
  const listed = fields(raw)?.devices;
  if (!Array.isArray(listed) || listed.length > 64) return null;
  const devices: MacDeviceEntry[] = [];
  for (const entry of listed as unknown[]) {
    const found = strings(entry, { device_id: 256, label: 256 });
    const at = (entry as Fields | null)?.updated_at;
    if (!found || typeof at !== 'number' || !Number.isFinite(at)) return null;
    devices.push({ ...found, updated_at: at });
  }
  return { v: 1, devices };
};

export const parseDesktopPairInvite = (raw: unknown): DesktopPairInvite | null => {
  const request = parseAgentRequest(raw);
  const content = raw as Fields;
  const cloudflare = request && cloudflareOf(content);
  const controller =
    request && strings(content.controller, { user_id: 512, device_id: 256, ed25519: 256 });
  const found = strings(content, {
    agent_user_id: 512,
    homeserver: 2048,
    user_id: 512,
    code: 256,
    requester_label: 256,
    sas_code: 6,
  });
  if (!request || !controller || !found || cloudflare === null) return null;
  if (!isSetupHomeserver(found.homeserver) || !/^\d{6}$/.test(found.sas_code)) return null;
  return { ...request, ...found, controller, cloudflare_access: cloudflare };
};

export const parseDesktopPairInviteConfirmed = (
  raw: unknown
): DesktopPairInviteConfirmed | null => {
  const nonce = nonceOf(raw);
  const result = nonce && outcome(raw as Fields);
  return nonce && result ? { v: 1, nonce, ...result } : null;
};

export const parseDesktopPairInviteResult = (raw: unknown): DesktopPairInviteResult | null => {
  const confirmed = parseDesktopPairInviteConfirmed(raw);
  if (!confirmed || !confirmed.ok) return confirmed;
  const claimed = strings(raw, CLAIMED);
  return claimed ? { ...confirmed, ...claimed } : null;
};

/** A fresh 32-character nonce that ties a reply to its request. */
export const createPairingNonce = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

/**
 * The six digits both screens show for one browser-to-Mac invite. They bind the invite's nonce and
 * pairing code to the browser device that sent it, so the Mac refuses an invite another device replays.
 */
export const derivePairInviteSas = async (
  nonce: string,
  code: string,
  browserDeviceId: string
): Promise<string> => {
  const digest = await sha256(new TextEncoder().encode(`${nonce}\0${code}\0${browserDeviceId}`));
  const number = new DataView(digest.buffer, digest.byteOffset).getUint32(0) % 1_000_000;
  return String(number).padStart(6, '0');
};

/** Python's `json.dumps` of one string: ASCII only, as the helper writes its controller keys. */
const pythonJsonString = (value: string): string =>
  JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  );

/** The helper's key of a controller: `controller_journal_key` of `command_journal.py`, verbatim. */
export const controllerKeyOf = ({ user_id, device_id, ed25519 }: PinnedDevice): string =>
  `[${[user_id, device_id, ed25519].map(pythonJsonString).join(', ')}]`;

/** Whether two homeserver URLs name the same server, whatever their trailing slashes. */
export const sameHomeserver = (a: string, b: string): boolean => {
  const key = (value: string): string | undefined => {
    try {
      const url = new URL(value);
      return url.origin + url.pathname.replace(/\/+$/, '');
    } catch {
      return undefined;
    }
  };
  return key(a) !== undefined && key(a) === key(b);
};
