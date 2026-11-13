import { ClientPrefix, Method, type Capabilities, type MatrixClient } from 'matrix-js-sdk';

/**
 * The local accounts of the homeserver, for its administrators: read through the Synapse admin
 * API the server answers (`/_synapse/admin/...`), locked and suspended through the Matrix
 * account moderation routes (`/_matrix/client/v1/admin/...`, MSC4323).
 */

/** One local account, as the admin API describes it. */
export type ServerAccount = {
  userId: string;
  displayName?: string;
  admin: boolean;
  deactivated: boolean;
  locked: boolean;
  /** Known from the account's details only; the list leaves it out. */
  suspended?: boolean;
  /** An external account (`user_type` "external"); false where the server does not say. */
  external: boolean;
  /** When one of its devices was last seen, in milliseconds. */
  lastSeenTs?: number;
};

export type AccountRoom = { roomId: string; name: string };

/** The `user_type` an external account carries. */
const EXTERNAL_USER_TYPE = 'external';
const SYNAPSE_ADMIN = { prefix: '' };
const PAGE_SIZE = 500;

/**
 * The server lists `m.account_moderation` among the capabilities of its administrators only,
 * so the signed-in user is one when it is there.
 */
export const isServerAdmin = (capabilities: Capabilities): boolean => {
  const moderation: unknown = capabilities['m.account_moderation'];
  if (typeof moderation !== 'object' || moderation === null) return false;
  const { lock, suspend } = moderation as { lock?: unknown; suspend?: unknown };
  return lock === true || suspend === true;
};

// Synapse writes some flags as 0 and 1.
const flag = (value: unknown): boolean => value === true || value === 1;

/** Reads one account of the list or of the details; a field the server leaves out stays unset. */
export const parseServerAccount = (raw: unknown): ServerAccount | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const fields = raw as Record<string, unknown>;
  const { name, displayname, last_seen_ts: lastSeen } = fields;
  if (typeof name !== 'string') return undefined;
  return {
    userId: name,
    displayName: typeof displayname === 'string' && displayname !== '' ? displayname : undefined,
    admin: flag(fields.admin),
    deactivated: flag(fields.deactivated),
    locked: flag(fields.locked),
    suspended: 'suspended' in fields ? flag(fields.suspended) : undefined,
    external: fields.user_type === EXTERNAL_USER_TYPE,
    lastSeenTs: typeof lastSeen === 'number' && lastSeen > 0 ? lastSeen : undefined,
  };
};

type AccountsPage = { users?: unknown; next_token?: unknown };

const listFrom = async (mx: MatrixClient, from?: string): Promise<ServerAccount[]> => {
  const page = await mx.http.authedRequest<AccountsPage>(
    Method.Get,
    '/_synapse/admin/v2/users',
    // Without these the server leaves deactivated and locked accounts out.
    { from, limit: PAGE_SIZE, deactivated: true, locked: true },
    undefined,
    SYNAPSE_ADMIN
  );
  const users: unknown[] = Array.isArray(page.users) ? page.users : [];
  const accounts = users
    .map(parseServerAccount)
    .filter((account): account is ServerAccount => account !== undefined);
  const next = users.length > 0 && typeof page.next_token === 'string' ? page.next_token : '';
  return next === '' ? accounts : [...accounts, ...(await listFrom(mx, next))];
};

/** Every local account, page by page. */
export const listServerAccounts = (mx: MatrixClient): Promise<ServerAccount[]> => listFrom(mx);

/** One account's details, which also say whether it is suspended. */
export const getServerAccount = async (
  mx: MatrixClient,
  userId: string
): Promise<ServerAccount | undefined> =>
  parseServerAccount(
    await mx.http.authedRequest<unknown>(
      Method.Get,
      `/_synapse/admin/v2/users/${encodeURIComponent(userId)}`,
      undefined,
      undefined,
      SYNAPSE_ADMIN
    )
  );

const adminRoomName = (mx: MatrixClient, roomId: string): Promise<string | undefined> =>
  mx.http
    .authedRequest<{ name?: unknown; canonical_alias?: unknown }>(
      Method.Get,
      `/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}`,
      undefined,
      undefined,
      SYNAPSE_ADMIN
    )
    .then((room) =>
      [room.name, room.canonical_alias].find(
        (name): name is string => typeof name === 'string' && name !== ''
      )
    )
    .catch(() => undefined);

/**
 * The rooms an account has joined, named as this client knows them, else as the server does,
 * else by their ID.
 */
export const listAccountRooms = async (
  mx: MatrixClient,
  userId: string
): Promise<AccountRoom[]> => {
  const { joined_rooms: joined } = await mx.http.authedRequest<{ joined_rooms?: unknown }>(
    Method.Get,
    `/_synapse/admin/v1/users/${encodeURIComponent(userId)}/joined_rooms`,
    undefined,
    undefined,
    SYNAPSE_ADMIN
  );
  const roomIds: unknown[] = Array.isArray(joined) ? joined : [];
  return Promise.all(
    roomIds
      .filter((roomId): roomId is string => typeof roomId === 'string')
      .map(async (roomId) => ({
        roomId,
        name: mx.getRoom(roomId)?.name ?? (await adminRoomName(mx, roomId)) ?? roomId,
      }))
  );
};

export type AccountAction = 'lock' | 'unlock' | 'suspend' | 'unsuspend' | 'deactivate';

/**
 * What an administrator may do to an account here: nothing to their own account or to another
 * administrator, nor to a deactivated account, which stays deactivated. The server refuses to
 * lock or suspend an administrator or the caller, but would deactivate either, so this is what
 * keeps that from happening here.
 */
export const accountActions = (
  account: ServerAccount,
  ownUserId: string | null
): AccountAction[] => {
  if (account.deactivated || account.admin || account.userId === ownUserId) return [];
  return [
    account.locked ? 'unlock' : 'lock',
    account.suspended ? 'unsuspend' : 'suspend',
    'deactivate',
  ];
};

export const runAccountAction = async (
  mx: MatrixClient,
  userId: string,
  action: AccountAction
): Promise<void> => {
  const moderate = (route: 'lock' | 'suspend', body: Record<string, boolean>) =>
    mx.http.authedRequest(
      Method.Put,
      `/admin/${route}/${encodeURIComponent(userId)}`,
      undefined,
      body,
      { prefix: ClientPrefix.V1 }
    );
  switch (action) {
    case 'lock':
    case 'unlock':
      await moderate('lock', { locked: action === 'lock' });
      return;
    case 'suspend':
    case 'unsuspend':
      await moderate('suspend', { suspended: action === 'suspend' });
      return;
    case 'deactivate':
      await mx.deactivateSynapseUser(userId);
  }
};

export const ACCOUNT_FILTERS = ['all', 'internal', 'external', 'deactivated'] as const;
export type AccountFilter = (typeof ACCOUNT_FILTERS)[number];

// Each filter is one plain rule: a deactivated account stays internal or external.
const inFilter = (account: ServerAccount, filter: AccountFilter): boolean => {
  switch (filter) {
    case 'all':
      return true;
    case 'internal':
      return !account.external;
    case 'external':
      return account.external;
    case 'deactivated':
      return account.deactivated;
  }
};

/** The accounts of a filter whose Matrix ID or display name holds the search text. */
export const filterAccounts = (
  accounts: readonly ServerAccount[],
  filter: AccountFilter,
  query: string
): ServerAccount[] => {
  const needle = query.trim().toLowerCase();
  return accounts.filter(
    (account) =>
      inFilter(account, filter) &&
      (account.userId.toLowerCase().includes(needle) ||
        (account.displayName?.toLowerCase().includes(needle) ?? false))
  );
};
