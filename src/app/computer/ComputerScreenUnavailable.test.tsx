// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import type { MatrixClient } from 'matrix-js-sdk';
import { ErrorBoundary } from 'react-error-boundary';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputerPanel } from './ComputerPanel';

// The screen's chunk is gone, as after a deployment removed the build this page runs.
vi.mock('./ComputerScreen', () => {
  throw new TypeError('Failed to fetch dynamically imported module: /assets/ComputerScreen-x.js');
});

const AGENT = '@mindroom_helper:example.org';

const answer = (body: unknown, status = 200) =>
  ({ ok: status < 300, status, json: () => Promise.resolve(body) } as Response);

/** A computer service that opens a session and hands out a stream ticket. */
const service = () =>
  vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname } = new URL(String(input));
    if (init?.method === 'DELETE') return Promise.resolve(answer(undefined, 204));
    if (pathname.endsWith('/stream-ticket')) {
      return Promise.resolve(answer({ ticket: 'ticket-1', expires_at: 2_000_000_000 }));
    }
    return Promise.resolve(
      answer({
        session_id: 'session-1',
        session_token: 'session-secret',
        state: 'ready',
        mode: 'view',
        expires_at: 2_000_000_000,
      })
    );
  });

const client = () =>
  ({
    getSafeUserId: () => '@reader:example.org',
    http: {
      authedRequest: vi.fn().mockResolvedValue({
        access_token: 'openid',
        token_type: 'Bearer',
        matrix_server_name: 'example.org',
        expires_in: 3600,
      }),
    },
  } as unknown as MatrixClient);

describe('ComputerScreenUnavailable', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps the panel open with Retry when the screen cannot load, instead of crashing the app', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const request = service();
    render(
      <ErrorBoundary fallback={<p>The app crashed</p>}>
        <ComputerPanel
          agents={[{ userId: AGENT, name: 'Helper' }]}
          apiUrl="https://computer.example.org"
          mx={client()}
          roomId="!room:example.org"
          onClose={vi.fn()}
          request={request}
        />
      </ErrorBoundary>
    );

    // The panel opened a stream, so it mounted the screen, whose load failed.
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(
      screen.getByText("This couldn't load. Check your connection and try again.")
    ).toBeTruthy();
    expect(request.mock.calls.some(([input]) => String(input).endsWith('/stream-ticket'))).toBe(
      true
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText('The app crashed')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Computer panel' })).toBeTruthy();
  });
});
