import { describe, expect, it, vi } from 'vitest';
import type { IOpenIDToken } from 'matrix-js-sdk';
import { createComputerSession, resolveComputerApiUrl } from './api';

const openIdToken: IOpenIDToken = {
  access_token: 'short-lived-openid-token',
  token_type: 'Bearer',
  matrix_server_name: 'example.org',
  expires_in: 3600,
};

const response = (status: number, body?: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response);

describe('computer api URL', () => {
  it.each([
    ['https://computer.example.org', 'https://computer.example.org'],
    ['https://computer.example.org/', 'https://computer.example.org'],
    ['http://localhost:8766', 'http://localhost:8766'],
    ['http://127.0.0.1:8766', 'http://127.0.0.1:8766'],
    ['http://[::1]:8766', 'http://[::1]:8766'],
  ])('accepts an exact trusted origin: %s', (configured, expected) => {
    expect(resolveComputerApiUrl(configured)).toBe(expected);
  });

  it.each([
    undefined,
    '',
    'http://computer.example.org',
    'https://user:password@computer.example.org',
    'https://computer.example.org/api',
    'https://computer.example.org/?token=secret',
    'https://computer.example.org/#fragment',
    'ws://computer.example.org',
    'not a url',
  ])('rejects a missing, malformed, or insecure remote origin: %s', (configured) => {
    expect(resolveComputerApiUrl(configured)).toBeUndefined();
  });
});

describe('computer session client', () => {
  it('creates with the complete OpenID token and uses only the session bearer afterwards', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          session_id: 'session-1',
          session_token: 'session-secret',
          state: 'ready',
          mode: 'view',
          expires_at: 2_000_000_000,
        })
      )
      .mockResolvedValueOnce(
        response(200, {
          ticket: 'one-use-ticket',
          expires_at: 2_000_000_000,
        })
      );

    const client = await createComputerSession({
      apiUrl: 'https://computer.example.org',
      agentUserId: '@mindroom_helper:example.org',
      openIdToken,
      request: request as unknown as typeof fetch,
      roomId: '!room:example.org',
    });
    const stream = await client.createStream();

    const createCall = request.mock.calls[0];
    expect(createCall[0]).toBe('https://computer.example.org/api/computers/sessions');
    expect(createCall[1]).toMatchObject({
      cache: 'no-store',
      credentials: 'same-origin',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
    expect(JSON.parse(createCall[1].body)).toEqual({
      openid_token: openIdToken,
      room_id: '!room:example.org',
      agent_user_id: '@mindroom_helper:example.org',
    });
    expect(JSON.stringify(createCall)).not.toContain('matrix-session-token');

    expect(request.mock.calls[1]).toEqual([
      'https://computer.example.org/api/computers/sessions/session-1/stream-ticket',
      {
        cache: 'no-store',
        credentials: 'same-origin',
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer session-secret',
        },
      },
    ]);
    expect(stream).toEqual({
      protocols: ['binary', 'mindroom-ticket.one-use-ticket'],
      url: 'wss://computer.example.org/api/computers/sessions/session-1/stream',
    });
  });
});
