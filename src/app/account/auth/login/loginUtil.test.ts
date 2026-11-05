import { describe, expect, it, vi } from 'vitest';
import { createMatrixClient } from '../../../matrix/client/matrixClientFactory';
import {
  LoginError,
  LoginFailure,
  getMatrixIdServer,
  login,
  resolveMatrixIdHomeserver,
} from './loginUtil';

vi.mock('../../../matrix/client/matrixClientFactory', () => ({
  createMatrixClient: vi.fn(),
  createMatrixFetchFn: (request: typeof fetch) => request,
}));

const PASSWORD_LOGIN = {
  type: 'm.login.password',
  identifier: { type: 'm.id.user', user: 'alice' },
  password: 'secret',
};

const loginWithWellKnown = async (baseUrl: string, wellKnownBaseUrl?: unknown) => {
  const loginRequest = vi.fn().mockResolvedValue({
    access_token: 'access',
    device_id: 'DEVICE',
    user_id: '@alice:example.com',
    ...(wellKnownBaseUrl === undefined
      ? {}
      : { well_known: { 'm.homeserver': { base_url: wellKnownBaseUrl } } }),
  });
  vi.mocked(createMatrixClient).mockReturnValue({ loginRequest } as never);
  return (await login(baseUrl, PASSWORD_LOGIN)).baseUrl;
};

describe('login homeserver URL', () => {
  it('keeps the login URL without a well-known answer', async () => {
    expect(await loginWithWellKnown('https://matrix.example.com')).toBe(
      'https://matrix.example.com'
    );
  });

  it('follows a well-known answer on the same origin', async () => {
    expect(await loginWithWellKnown('https://example.com', ' https://example.com/matrix/ ')).toBe(
      'https://example.com/matrix'
    );
  });

  it('ignores a well-known answer that points at another server', async () => {
    expect(await loginWithWellKnown('https://example.com', 'https://evil.example.org')).toBe(
      'https://example.com'
    );
    expect(await loginWithWellKnown('https://example.com', 'https://example.com:8448')).toBe(
      'https://example.com'
    );
  });

  it('ignores a well-known answer that discovery would refuse', async () => {
    expect(await loginWithWellKnown('http://example.com', 'http://example.com/matrix')).toBe(
      'http://example.com'
    );
    expect(await loginWithWellKnown('https://example.com', 'not a url')).toBe(
      'https://example.com'
    );
    expect(await loginWithWellKnown('https://example.com', 42)).toBe('https://example.com');
  });

  it('follows a plain HTTP answer on the local network', async () => {
    expect(await loginWithWellKnown('http://localhost:8008', 'http://localhost:8008/matrix')).toBe(
      'http://localhost:8008/matrix'
    );
  });
});

describe('Matrix ID homeserver', () => {
  const wellKnown = (answers: Record<string, unknown>): typeof fetch =>
    (async (input: string) => {
      const host = new URL(input).host;
      if (!(host in answers)) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify(answers[host]), { status: 200 });
    }) as unknown as typeof fetch;
  const anyServer = () => true;

  it('reads the server name of a full Matrix ID only', () => {
    expect(getMatrixIdServer('@alice:example.org')).toBe('example.org');
    expect(getMatrixIdServer('@alice:example.org:8448')).toBe('example.org:8448');
    expect(getMatrixIdServer('alice')).toBeUndefined();
    expect(getMatrixIdServer('@alice')).toBeUndefined();
    expect(getMatrixIdServer('@alice:')).toBeUndefined();
  });

  it('logs in where the Matrix ID server says its homeserver is', async () => {
    const request = wellKnown({
      'example.org': { 'm.homeserver': { base_url: 'https://matrix.example.org/' } },
    });
    expect(
      await resolveMatrixIdHomeserver(
        '@alice:example.org',
        'https://other.test',
        anyServer,
        request
      )
    ).toBe('https://matrix.example.org');
  });

  it('stays at the picked server for a plain username or an unreachable server name', async () => {
    const request = wellKnown({});
    expect(await resolveMatrixIdHomeserver('alice', 'https://a.test', anyServer, request)).toBe(
      'https://a.test'
    );
    expect(
      await resolveMatrixIdHomeserver(
        '@alice:matrix.localhost',
        'http://127.0.0.1:8008',
        anyServer,
        request
      )
    ).toBe('http://127.0.0.1:8008');
  });

  it('refuses a server the deployment does not offer', async () => {
    const request = wellKnown({
      'example.org': { 'm.homeserver': { base_url: 'https://matrix.example.org' } },
    });
    const attempt = resolveMatrixIdHomeserver(
      '@alice:example.org',
      'https://mindroom.test',
      () => false,
      request
    );
    await expect(attempt).rejects.toBeInstanceOf(LoginFailure);
    await expect(attempt).rejects.toMatchObject({ code: LoginError.ServerNotAllowed });
  });

  it('refuses a server whose well-known points at plain HTTP outside the local network', async () => {
    const request = wellKnown({
      'example.org': { 'm.homeserver': { base_url: 'http://matrix.example.org' } },
    });
    await expect(
      resolveMatrixIdHomeserver('@alice:example.org', 'https://a.test', anyServer, request)
    ).rejects.toMatchObject({ code: LoginError.InvalidServer });
  });
});
