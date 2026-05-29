import { LocalMindroomConnection } from './api';

export const DEFAULT_MINDROOM_DOCS_URL = 'https://docs.mindroom.chat/';
const WELCOME_SETUP_PROMPT_DELAY_MS = 24 * 60 * 60 * 1000;

export const getMindroomDocsUrl = (url?: string): string =>
  url?.trim() || DEFAULT_MINDROOM_DOCS_URL;

type ResolveProvisioningRequest = {
  sessionHomeserverUrl?: string;
  provisioningOverrideUrl?: string;
  accessToken?: string;
};

export type LocalMindroomProvisioningRequest = {
  provisioningBaseUrl?: string;
  accessToken?: string;
  warning?: string;
};

const getOrigin = (url?: string): string | undefined => {
  const value = url?.trim();
  if (!value) return undefined;

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
};

export const resolveMindroomProvisioningRequest = ({
  sessionHomeserverUrl,
  provisioningOverrideUrl,
  accessToken,
}: ResolveProvisioningRequest): LocalMindroomProvisioningRequest => {
  const sessionOrigin = getOrigin(sessionHomeserverUrl);
  const overrideOrigin = getOrigin(provisioningOverrideUrl);
  const provisioningBaseUrl = overrideOrigin ?? sessionOrigin;

  if (!provisioningBaseUrl) return {};

  const isCrossOriginOverride =
    overrideOrigin !== undefined && sessionOrigin !== undefined && overrideOrigin !== sessionOrigin;

  if (isCrossOriginOverride) {
    return {
      provisioningBaseUrl,
      warning:
        'Provisioning URL uses a different origin than your active homeserver. Access token forwarding is blocked by default for safety.',
    };
  }

  return {
    provisioningBaseUrl,
    accessToken,
  };
};

export const getMindroomPairingCommand = (pairCode: string): string =>
  `uvx mindroom connect --pair-code ${pairCode}`;

export const getWelcomeSetupFirstSeenStorageKey = (userId: string): string =>
  `mindroom_welcome_setup_first_seen_at::${userId}`;

export type WelcomeSetupPromptState = {
  activeConnectionCount: number;
  firstSeenAtMs: number | undefined;
  nowMs?: number;
};

export const shouldShowWelcomeSetupPrompt = ({
  activeConnectionCount,
  firstSeenAtMs,
  nowMs = Date.now(),
}: WelcomeSetupPromptState): boolean =>
  activeConnectionCount === 0 &&
  firstSeenAtMs !== undefined &&
  nowMs - firstSeenAtMs >= WELCOME_SETUP_PROMPT_DELAY_MS;

export const getPairingSecondsRemaining = (
  expiresAt: string,
  nowMs: number = Date.now()
): number => {
  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) return 0;
  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
};

export const getConnectionId = (connection: LocalMindroomConnection): string | undefined => {
  if (typeof connection.id === 'string' && connection.id.length > 0) return connection.id;

  const rawId = connection.connection_id;
  if (typeof rawId === 'string' && rawId.length > 0) return rawId;

  const numericId = connection.connection_id;
  if (typeof numericId === 'number') return numericId.toString();

  return undefined;
};

export const getConnectionName = (connection: LocalMindroomConnection, index: number): string => {
  if (typeof connection.client_name === 'string' && connection.client_name.trim()) {
    return connection.client_name;
  }

  const altName = connection.clientName;
  if (typeof altName === 'string' && altName.trim()) return altName;

  return `Local MindRoom ${index + 1}`;
};

export const getConnectionCreatedAt = (connection: LocalMindroomConnection): string | undefined => {
  if (typeof connection.created_at === 'string' && connection.created_at)
    return connection.created_at;

  const alt = connection.createdAt;
  if (typeof alt === 'string' && alt) return alt;

  return undefined;
};

export const getConnectionLastSeenAt = (
  connection: LocalMindroomConnection
): string | undefined => {
  if (typeof connection.last_seen_at === 'string' && connection.last_seen_at) {
    return connection.last_seen_at;
  }

  const alt = connection.lastSeenAt;
  if (typeof alt === 'string' && alt) return alt;

  return undefined;
};

export const getConnectionRevokedAt = (connection: LocalMindroomConnection): string | undefined => {
  const direct = connection.revoked_at;
  if (typeof direct === 'string' && direct) return direct;

  const alt = connection.revokedAt;
  if (typeof alt === 'string' && alt) return alt;

  return undefined;
};

export const isConnectionRevoked = (connection: LocalMindroomConnection): boolean =>
  getConnectionRevokedAt(connection) !== undefined;

export const formatLocalTimestamp = (timestamp?: string): string => {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) return 'Unknown';
  return date.toLocaleString();
};
