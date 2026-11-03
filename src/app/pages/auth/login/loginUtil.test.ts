import { describe, expect, it, vi } from 'vitest';
import { createMatrixClient } from '../../../mindroom/matrix/matrixClientFactory';
import { login } from './loginUtil';

vi.mock('../../../mindroom/matrix/matrixClientFactory', () => ({
  createMatrixClient: vi.fn(),
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
