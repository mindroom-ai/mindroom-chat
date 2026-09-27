// @vitest-environment jsdom

import { TokenRefreshLogoutError } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import hostedClientConfig from '../../../../config.mindroom.json';
import { LocalMindroomApiError } from './api';
import { getPairingAccounts, normalizePairCode, requestAsStoredSession } from './devicePairing';
import {
  getSessionStore,
  putSession,
  updateSessionCredentials,
  type StoredSession,
} from '../../state/sessions';

const storeSession = (
  userId: string,
  baseUrl: string,
  tokens: { accessToken?: string; refreshToken?: string } = {}
): StoredSession =>
  putSession({
    baseUrl,
    userId,
    deviceId: 'DEVICE',
    accessToken: tokens.accessToken ?? `${userId}-access`,
    refreshToken: tokens.refreshToken,
  });

const unauthorized = () => new LocalMindroomApiError('Invalid Matrix access token', 401);

afterEach(() => {
  localStorage.clear();
});

describe('normalizePairCode', () => {
  it.each([
    ['ABCD-EFGH', 'ABCD-EFGH'],
    ['abcd-efgh', 'ABCD-EFGH'],
    ['  abcdefgh ', 'ABCD-EFGH'],
    ['ABCD EFGH', 'ABCD-EFGH'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizePairCode(input)).toBe(expected);
  });

  it.each(['', 'ABC', 'ABCD-EFGH-J', 'ABCD_EFGH', null, undefined])('rejects %j', (input) => {
    expect(normalizePairCode(input)).toBeUndefined();
  });
});

describe('getPairingAccounts', () => {
  it('keeps only accounts whose provisioning request carries their token', () => {
    const hosted = storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    storeSession('@bob:matrix.org', 'https://matrix-client.matrix.org');

    const accounts = getPairingAccounts(
      getSessionStore().sessions,
      'https://mindroom.chat/provisioning'
    );

    expect(accounts).toEqual([{ session: hosted, provisioningBaseUrl: 'https://mindroom.chat' }]);
  });

  it('limits the hosted client to mindroom.chat accounts', () => {
    const hosted = storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    const foreign = storeSession('@bob:matrix.org', 'https://matrix-client.matrix.org');

    expect(
      getPairingAccounts([hosted, foreign], hostedClientConfig.sidebar.mindRoomProvisioningUrl)
    ).toEqual([{ session: hosted, provisioningBaseUrl: 'https://mindroom.chat' }]);
  });

  it('uses each account homeserver as its provisioning origin without an override', () => {
    const hosted = storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    const other = storeSession('@bob:example.org', 'https://matrix.example.org');

    expect(getPairingAccounts([hosted, other], undefined)).toEqual([
      { session: hosted, provisioningBaseUrl: 'https://mindroom.chat' },
      { session: other, provisioningBaseUrl: 'https://matrix.example.org' },
    ]);
  });
});

describe('requestAsStoredSession', () => {
  it('uses the stored access token of the chosen account', async () => {
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    const request = vi.fn().mockResolvedValue('ok');
    const refresh = vi.fn();

    await expect(requestAsStoredSession(session.sessionId, request, refresh)).resolves.toBe('ok');

    expect(request.mock.calls).toEqual([['@alice:mindroom.chat-access']]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes an expired token once and retries with the new token', async () => {
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat', {
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
    });
    const request = vi.fn().mockRejectedValueOnce(unauthorized()).mockResolvedValueOnce('ok');
    const refresh = vi.fn().mockResolvedValue('access-b');

    await expect(requestAsStoredSession(session.sessionId, request, refresh)).resolves.toBe('ok');

    expect(refresh.mock.calls).toEqual([
      [expect.objectContaining({ sessionId: session.sessionId, refreshToken: 'refresh-a' })],
    ]);
    expect(request.mock.calls).toEqual([['access-a'], ['access-b']]);
  });

  it('retries only once when the refreshed token is also rejected', async () => {
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat', {
      refreshToken: 'refresh-a',
    });
    const request = vi.fn().mockRejectedValue(unauthorized());
    const refresh = vi.fn().mockResolvedValue('access-b');

    await expect(requestAsStoredSession(session.sessionId, request, refresh)).rejects.toMatchObject(
      {
        status: 401,
      }
    );

    expect(request).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('retries with credentials another tab already rotated instead of refreshing again', async () => {
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat', {
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
    });
    const request = vi
      .fn()
      .mockImplementationOnce(async () => {
        updateSessionCredentials(session.sessionId, {
          accessToken: 'access-b',
          refreshToken: 'refresh-b',
        });
        throw unauthorized();
      })
      .mockResolvedValueOnce('ok');
    const refresh = vi.fn();

    await expect(requestAsStoredSession(session.sessionId, request, refresh)).resolves.toBe('ok');

    expect(request.mock.calls).toEqual([['access-a'], ['access-b']]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('rejects accounts that are no longer stored as signed out', async () => {
    const request = vi.fn();

    await expect(requestAsStoredSession('missing-session', request, vi.fn())).rejects.toMatchObject(
      { status: 401 }
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('does not refresh for errors other than an invalid token', async () => {
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat', {
      refreshToken: 'refresh-a',
    });
    const request = vi.fn().mockRejectedValue(new LocalMindroomApiError('Pair code expired', 410));
    const refresh = vi.fn();

    await expect(requestAsStoredSession(session.sessionId, request, refresh)).rejects.toMatchObject(
      {
        status: 410,
      }
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps the invalid-token error when the account cannot be refreshed', async () => {
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    const request = vi.fn().mockRejectedValue(unauthorized());
    const refresh = vi.fn().mockResolvedValue(undefined);

    await expect(requestAsStoredSession(session.sessionId, request, refresh)).rejects.toMatchObject(
      {
        status: 401,
      }
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reports a rejected refresh token as the invalid-token error', async () => {
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat', {
      refreshToken: 'refresh-a',
    });
    const request = vi.fn().mockRejectedValue(unauthorized());
    const refresh = vi.fn().mockRejectedValue(new TokenRefreshLogoutError(new Error('gone')));

    await expect(requestAsStoredSession(session.sessionId, request, refresh)).rejects.toMatchObject(
      {
        status: 401,
      }
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
});
