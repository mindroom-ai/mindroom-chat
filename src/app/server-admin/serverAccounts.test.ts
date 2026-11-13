import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import {
  accountActions,
  filterAccounts,
  getServerAccount,
  isServerAdmin,
  listAccountRooms,
  listServerAccounts,
  parseServerAccount,
  runAccountAction,
  type ServerAccount,
} from './serverAccounts';

type Answer = (path: string, query: Record<string, unknown> | undefined) => unknown;

const clientWith = (answer: Answer) => {
  const authedRequest = vi.fn(
    async (_method: string, path: string, query?: Record<string, unknown>) => answer(path, query)
  );
  const deactivateSynapseUser = vi.fn(async () => ({}));
  const getRoom = vi.fn((roomId: string) =>
    roomId === '!known:example.com' ? { name: 'Known' } : null
  );
  const client = { http: { authedRequest }, deactivateSynapseUser, getRoom };
  return { client: client as unknown as MatrixClient, authedRequest, deactivateSynapseUser };
};

const account = (userId: string, fields: Partial<ServerAccount> = {}): ServerAccount => ({
  userId,
  admin: false,
  deactivated: false,
  locked: false,
  external: false,
  ...fields,
});

describe('isServerAdmin', () => {
  it('is true only with the account moderation capability', () => {
    expect(isServerAdmin({})).toBe(false);
    expect(isServerAdmin({ 'm.change_password': { enabled: true } })).toBe(false);
    expect(isServerAdmin({ 'm.account_moderation': { lock: false, suspend: false } })).toBe(false);
    expect(isServerAdmin({ 'm.account_moderation': 'yes' })).toBe(false);
    expect(isServerAdmin({ 'm.account_moderation': { lock: true, suspend: true } })).toBe(true);
    expect(isServerAdmin({ 'm.account_moderation': { suspend: true } })).toBe(true);
  });
});

describe('parseServerAccount', () => {
  it('reads the fields the server sends', () => {
    expect(
      parseServerAccount({
        name: '@alice:example.com',
        displayname: 'Alice',
        admin: true,
        deactivated: false,
        locked: 1,
        suspended: true,
        user_type: 'external',
        last_seen_ts: 1700000000000,
      })
    ).toEqual({
      userId: '@alice:example.com',
      displayName: 'Alice',
      admin: true,
      deactivated: false,
      locked: true,
      suspended: true,
      external: true,
      lastSeenTs: 1700000000000,
    });
  });

  it('leaves out what the server does not send', () => {
    expect(
      parseServerAccount({ name: '@bob:example.com', displayname: '', last_seen_ts: null })
    ).toEqual({
      userId: '@bob:example.com',
      displayName: undefined,
      admin: false,
      deactivated: false,
      locked: false,
      suspended: undefined,
      external: false,
      lastSeenTs: undefined,
    });
    expect(parseServerAccount({ name: '@bob:example.com', user_type: null })?.external).toBe(false);
    expect(parseServerAccount({ displayname: 'No ID' })).toBeUndefined();
    expect(parseServerAccount('nonsense')).toBeUndefined();
  });
});

describe('listServerAccounts', () => {
  it('asks for locked and deactivated accounts too and follows every page', async () => {
    const { client, authedRequest } = clientWith((_path, query) =>
      query?.from === undefined
        ? { users: [{ name: '@alice:example.com' }, { broken: true }], next_token: '2', total: 3 }
        : { users: [{ name: '@bob:example.com', deactivated: true }], total: 3 }
    );

    const accounts = await listServerAccounts(client);

    expect(accounts.map((entry) => entry.userId)).toEqual([
      '@alice:example.com',
      '@bob:example.com',
    ]);
    expect(authedRequest).toHaveBeenCalledTimes(2);
    expect(authedRequest).toHaveBeenNthCalledWith(
      1,
      'GET',
      '/_synapse/admin/v2/users',
      { from: undefined, limit: 500, deactivated: true, locked: true },
      undefined,
      { prefix: '' }
    );
    expect(authedRequest.mock.calls[1]?.[2]).toMatchObject({ from: '2' });
  });

  it('stops at an empty page even when it names a next one', async () => {
    const { client, authedRequest } = clientWith(() => ({ users: [], next_token: '0' }));
    expect(await listServerAccounts(client)).toEqual([]);
    expect(authedRequest).toHaveBeenCalledTimes(1);
  });
});

describe('account details', () => {
  it('reads one account by its encoded ID', async () => {
    const { client, authedRequest } = clientWith(() => ({
      name: '@alice:example.com',
      suspended: true,
    }));
    expect((await getServerAccount(client, '@alice:example.com'))?.suspended).toBe(true);
    expect(authedRequest.mock.calls[0]?.[1]).toBe(
      '/_synapse/admin/v2/users/%40alice%3Aexample.com'
    );
  });

  it('names rooms from the client, then from the server, then by ID', async () => {
    const { client } = clientWith((path) => {
      if (path.endsWith('/joined_rooms')) {
        return {
          joined_rooms: ['!known:example.com', '!named:example.com', '!hidden:example.com'],
        };
      }
      if (path.includes(encodeURIComponent('!named:example.com'))) return { name: 'Named' };
      throw new Error('M_NOT_FOUND');
    });

    expect(await listAccountRooms(client, '@alice:example.com')).toEqual([
      { roomId: '!known:example.com', name: 'Known' },
      { roomId: '!named:example.com', name: 'Named' },
      { roomId: '!hidden:example.com', name: '!hidden:example.com' },
    ]);
  });
});

describe('accountActions', () => {
  it('offers the opposite of each state', () => {
    expect(accountActions(account('@bob:example.com'), '@alice:example.com')).toEqual([
      'lock',
      'suspend',
      'deactivate',
    ]);
    expect(
      accountActions(
        account('@bob:example.com', { locked: true, suspended: true }),
        '@alice:example.com'
      )
    ).toEqual(['unlock', 'unsuspend', 'deactivate']);
  });

  it('offers nothing for the own account, an administrator or a deactivated account', () => {
    expect(accountActions(account('@alice:example.com'), '@alice:example.com')).toEqual([]);
    expect(
      accountActions(account('@bob:example.com', { admin: true }), '@alice:example.com')
    ).toEqual([]);
    expect(
      accountActions(account('@bob:example.com', { deactivated: true }), '@alice:example.com')
    ).toEqual([]);
  });
});

describe('runAccountAction', () => {
  it.each([
    ['lock', '/admin/lock/%40bob%3Aexample.com', { locked: true }],
    ['unlock', '/admin/lock/%40bob%3Aexample.com', { locked: false }],
    ['suspend', '/admin/suspend/%40bob%3Aexample.com', { suspended: true }],
    ['unsuspend', '/admin/suspend/%40bob%3Aexample.com', { suspended: false }],
  ] as const)('%s calls the moderation route', async (action, path, body) => {
    const { client, authedRequest, deactivateSynapseUser } = clientWith(() => ({}));
    await runAccountAction(client, '@bob:example.com', action);
    expect(authedRequest).toHaveBeenCalledWith('PUT', path, undefined, body, {
      prefix: '/_matrix/client/v1',
    });
    expect(deactivateSynapseUser).not.toHaveBeenCalled();
  });

  it('deactivates through the admin API', async () => {
    const { client, authedRequest, deactivateSynapseUser } = clientWith(() => ({}));
    await runAccountAction(client, '@bob:example.com', 'deactivate');
    expect(deactivateSynapseUser).toHaveBeenCalledWith('@bob:example.com');
    expect(authedRequest).not.toHaveBeenCalled();
  });
});

describe('filterAccounts', () => {
  const accounts = [
    account('@alice:example.com', { displayName: 'Alice Admin', admin: true }),
    account('@bob:example.com', { displayName: 'Bob' }),
    account('@carol:example.com', { displayName: 'Carol Guest', external: true }),
    account('@dave:example.com', { deactivated: true }),
    account('@erin:example.com', { deactivated: true, external: true }),
  ];
  const ids = (list: ServerAccount[]) => list.map((entry) => entry.userId.slice(1, -12));

  it('sorts accounts into internal, external and deactivated, each a plain rule', () => {
    expect(ids(filterAccounts(accounts, 'all', ''))).toEqual([
      'alice',
      'bob',
      'carol',
      'dave',
      'erin',
    ]);
    // A deactivated account stays internal or external, under its badge.
    expect(ids(filterAccounts(accounts, 'internal', ''))).toEqual(['alice', 'bob', 'dave']);
    expect(ids(filterAccounts(accounts, 'external', ''))).toEqual(['carol', 'erin']);
    expect(ids(filterAccounts(accounts, 'deactivated', ''))).toEqual(['dave', 'erin']);
  });

  it('searches the Matrix ID and the display name, whatever the case', () => {
    expect(ids(filterAccounts(accounts, 'all', ' GUEST '))).toEqual(['carol']);
    expect(ids(filterAccounts(accounts, 'all', '@da'))).toEqual(['dave']);
    expect(ids(filterAccounts(accounts, 'internal', 'carol'))).toEqual([]);
  });
});
