// @vitest-environment jsdom

import React, { useEffect } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComputerPanel, type ComputerPanelProps } from './ComputerPanel';
import type { ComputerScreenProps } from './ComputerScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Button: ({
    before,
    children,
    ...props
  }: React.ComponentProps<'button'> & { before?: React.ReactNode }) => (
    <button {...props}>
      {before}
      {children}
    </button>
  ),
  Icon: () => <span />,
  IconButton: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
  Icons: { Cross: 'Cross', Monitor: 'Monitor' },
  Spinner: () => <span />,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('./ComputerPanel.css.ts', () => ({
  Actions: 'Actions',
  AgentSelect: 'AgentSelect',
  Body: 'Body',
  Error: 'Error',
  Header: 'Header',
  Panel: 'Panel',
  Screen: 'Screen',
  ScreenFrame: 'ScreenFrame',
  Status: 'Status',
}));

const openIdToken = {
  access_token: 'short-lived-openid-token',
  token_type: 'Bearer',
  matrix_server_name: 'example.org',
  expires_in: 3600,
};

const jsonResponse = (status: number, body?: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response);

const makeStatus = (sessionId: string, mode: 'view' | 'control' = 'view') => ({
  session_id: sessionId,
  session_token: `secret-${sessionId}`,
  state: 'ready',
  mode,
  expires_at: 2_000_000_000,
});

const createGateway = () => {
  let nextSession = 1;
  let nextTicket = 1;
  const modes = new Map<string, 'view' | 'control'>();
  const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    if (init?.method === 'POST' && url.pathname === '/api/computers/sessions') {
      const sessionId = `session-${nextSession++}`;
      modes.set(sessionId, 'view');
      return jsonResponse(200, makeStatus(sessionId));
    }
    const match = url.pathname.match(/^\/api\/computers\/sessions\/([^/]+)(.*)$/);
    if (!match) return jsonResponse(404, { detail: 'Not found' });
    const [, sessionId, suffix] = match;
    if (init?.method === 'DELETE' && suffix === '') return jsonResponse(204);
    if (init?.method === 'GET' && suffix === '') {
      return jsonResponse(200, makeStatus(sessionId, modes.get(sessionId)));
    }
    if (init?.method === 'POST' && suffix === '/stream-ticket') {
      return jsonResponse(200, {
        ticket: `ticket-${nextTicket++}`,
        expires_at: 2_000_000_000,
      });
    }
    if (init?.method === 'POST' && suffix === '/control') {
      const action = JSON.parse(init.body as string).action as 'take' | 'release' | 'stop';
      const mode = action === 'take' ? 'control' : 'view';
      modes.set(sessionId, mode);
      return jsonResponse(200, {
        ...makeStatus(sessionId, mode),
        state: action === 'stop' ? 'stopped' : 'ready',
      });
    }
    return jsonResponse(404, { detail: 'Not found' });
  });
  return request as unknown as typeof fetch;
};

const screenConnections: ComputerScreenProps[] = [];
const screenDisposals = vi.fn();
const TestScreen = (screenProps: ComputerScreenProps) => {
  const screenPropsRef = React.useRef(screenProps);
  screenPropsRef.current = screenProps;
  const { mode, url } = screenProps;
  useEffect(() => {
    const connection = screenPropsRef.current;
    screenConnections.push(connection);
    connection.onConnected();
    return () => screenDisposals();
  }, [url]);
  return <div data-testid="computer-screen" data-mode={mode} />;
};

const makeMatrixClient = (userId = '@alice:example.org') =>
  ({
    getOpenIdToken: vi.fn().mockResolvedValue(openIdToken),
    getSafeUserId: () => userId,
    sendMessage: vi.fn().mockResolvedValue({ event_id: '$continuation' }),
  } as unknown as MatrixClient);

const findButton = (container: HTMLElement, name: string): HTMLButtonElement => {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) =>
      candidate.textContent?.trim() === name || candidate.getAttribute('aria-label') === name
  );
  if (!button) throw new Error(`Missing button: ${name}; content: ${container.textContent}`);
  return button;
};

const click = async (button: HTMLButtonElement) => {
  await act(async () => button.click());
};

const waitFor = async (assertion: () => void) => {
  await vi.waitFor(async () => {
    await act(async () => Promise.resolve());
    assertion();
  });
};

describe('ComputerPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    screenConnections.length = 0;
    screenDisposals.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderPanel = (overrides: Partial<ComputerPanelProps> = {}) => {
    const props: ComputerPanelProps = {
      agents: [{ userId: '@mindroom_helper:example.org', name: 'Helper' }],
      apiUrl: 'https://computer.example.org',
      mx: makeMatrixClient(),
      onClose: vi.fn(),
      request: createGateway(),
      roomId: '!room:example.org',
      ScreenComponent: TestScreen,
      threadId: '$thread',
      ...overrides,
    };
    act(() => root.render(<ComputerPanel {...props} />));
    return props;
  };

  it('moves from watch through control and release, reconnecting before showing watch again', async () => {
    const props = renderPanel();

    await waitFor(() =>
      expect(findButton(container, 'Take control')).toBeInstanceOf(HTMLButtonElement)
    );
    expect(container.textContent).toContain('Watch mode');

    await click(findButton(container, 'Take control'));
    await waitFor(() =>
      expect(findButton(container, 'Resume agent')).toBeInstanceOf(HTMLButtonElement)
    );
    expect(container.textContent).toContain('You have control');

    await click(findButton(container, 'Resume agent'));
    await waitFor(() =>
      expect(findButton(container, 'Take control')).toBeInstanceOf(HTMLButtonElement)
    );

    expect(container.textContent).toContain('Control released');
    expect(screenConnections).toHaveLength(2);
    expect(screenConnections[0].protocols[1]).toBe('mindroom-ticket.ticket-1');
    expect(screenConnections[1].protocols[1]).toBe('mindroom-ticket.ticket-2');
    expect(screenConnections[1].url).toContain('/sessions/session-1/stream');
    expect(props.mx.sendMessage).toHaveBeenCalledTimes(1);
    expect(props.mx.sendMessage).toHaveBeenCalledWith(
      '!room:example.org',
      expect.objectContaining({
        body: '@mindroom_helper:example.org The computer is available again. Please continue.',
        'm.mentions': { user_ids: ['@mindroom_helper:example.org'] },
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: '$thread',
          is_falling_back: true,
          'm.in_reply_to': { event_id: '$thread' },
        },
      })
    );
  });

  it('ignores the retired control stream closing while continuation delivery is pending', async () => {
    let resolveContinuation: ((value: { event_id: string }) => void) | undefined;
    const continuation = new Promise<{ event_id: string }>((resolve) => {
      resolveContinuation = resolve;
    });
    const mx = makeMatrixClient();
    vi.mocked(mx.sendMessage).mockReturnValue(continuation);
    renderPanel({ mx });

    await waitFor(() => findButton(container, 'Take control'));
    await click(findButton(container, 'Take control'));
    await waitFor(() => findButton(container, 'Resume agent'));
    await click(findButton(container, 'Resume agent'));
    await waitFor(() => expect(screenConnections).toHaveLength(2));

    act(() => screenConnections[0].onDisconnected('Retired control stream closed.'));

    expect(container.textContent).not.toContain('Retired control stream closed.');
    expect(container.textContent).not.toContain('Computer disconnected');
    expect(container.querySelector('[data-testid="computer-screen"]')).not.toBeNull();

    await act(async () => resolveContinuation?.({ event_id: '$continuation' }));
    expect(mx.sendMessage).toHaveBeenCalledOnce();
  });

  it('reconnects a failed replacement watch stream while continuation delivery is pending', async () => {
    let resolveContinuation: ((value: { event_id: string }) => void) | undefined;
    const continuation = new Promise<{ event_id: string }>((resolve) => {
      resolveContinuation = resolve;
    });
    const mx = makeMatrixClient();
    vi.mocked(mx.sendMessage).mockReturnValue(continuation);
    renderPanel({ mx });

    await waitFor(() => findButton(container, 'Take control'));
    await click(findButton(container, 'Take control'));
    await waitFor(() => findButton(container, 'Resume agent'));
    await click(findButton(container, 'Resume agent'));
    await waitFor(() => expect(screenConnections).toHaveLength(2));

    act(() => screenConnections[1].onDisconnected('Replacement watch stream closed.'));

    await waitFor(() => findButton(container, 'Reconnect'));
    expect(container.textContent).toContain('Replacement watch stream closed.');
    await act(async () => resolveContinuation?.({ event_id: '$continuation' }));
    await waitFor(() => expect(findButton(container, 'Reconnect').disabled).toBe(false));
    expect(mx.sendMessage).toHaveBeenCalledOnce();

    await click(findButton(container, 'Reconnect'));
    await waitFor(() => expect(screenConnections).toHaveLength(3));
    expect(screenConnections.map(({ protocols }) => protocols[1])).toEqual([
      'mindroom-ticket.ticket-1',
      'mindroom-ticket.ticket-2',
      'mindroom-ticket.ticket-3',
    ]);
    expect(mx.sendMessage).toHaveBeenCalledOnce();
  });

  it('sends the continuation exactly once even when watch reconnect fails', async () => {
    const gateway = createGateway();
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (
        url.endsWith('/stream-ticket') &&
        request.mock.calls.filter(([value]) => value.toString().endsWith('/stream-ticket'))
          .length === 2
      ) {
        return jsonResponse(503, { detail: 'Computer stream is unavailable.' });
      }
      return gateway(input, init);
    }) as unknown as typeof fetch;
    const props = renderPanel({ request });

    await waitFor(() => findButton(container, 'Take control'));
    await click(findButton(container, 'Take control'));
    await waitFor(() => findButton(container, 'Resume agent'));
    await click(findButton(container, 'Resume agent'));

    await waitFor(() => expect(container.textContent).toContain('Computer stream is unavailable.'));
    expect(props.mx.sendMessage).toHaveBeenCalledTimes(1);
    await click(findButton(container, 'Reconnect'));
    await waitFor(() => findButton(container, 'Take control'));
    expect(props.mx.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('creates a fresh public session after stop', async () => {
    const request = createGateway();
    renderPanel({ request });
    await waitFor(() => findButton(container, 'Take control'));

    await click(findButton(container, 'Stop'));
    await waitFor(() => expect(container.textContent).toContain('Computer stopped'));
    await click(findButton(container, 'Start computer'));
    await waitFor(() => findButton(container, 'Take control'));

    const createCalls = vi
      .mocked(request)
      .mock.calls.filter(
        ([url, init]) =>
          url.toString().endsWith('/api/computers/sessions') && init?.method === 'POST'
      );
    expect(createCalls).toHaveLength(2);
    expect(screenConnections.at(-1)?.url).toContain('/sessions/session-2/stream');
  });

  it('waits for an explicit Watch action when more than one agent is available', async () => {
    const request = createGateway();
    renderPanel({
      agents: [
        { userId: '@mindroom_helper:example.org', name: 'Helper' },
        { userId: '@mindroom_writer:example.org', name: 'Writer' },
      ],
      request,
    });

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Agent"]');
    expect(select).not.toBeNull();
    await act(async () => {
      if (select) {
        select.value = '@mindroom_writer:example.org';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(vi.mocked(request)).not.toHaveBeenCalled();
    await click(findButton(container, 'Watch computer'));
    await waitFor(() => findButton(container, 'Take control'));

    expect(JSON.parse(vi.mocked(request).mock.calls[0][1]?.body as string)).toMatchObject({
      agent_user_id: '@mindroom_writer:example.org',
    });
  });

  it('keeps control released and does not retry a failed continuation send', async () => {
    const mx = makeMatrixClient();
    vi.mocked(mx.sendMessage).mockRejectedValue(new Error('send failed'));
    renderPanel({ mx });
    await waitFor(() => findButton(container, 'Take control'));
    await click(findButton(container, 'Take control'));
    await waitFor(() => findButton(container, 'Resume agent'));

    await click(findButton(container, 'Resume agent'));

    await waitFor(() =>
      expect(container.textContent).toContain(
        'Control was released, but the continuation message could not be sent.'
      )
    );
    expect(findButton(container, 'Take control')).toBeInstanceOf(HTMLButtonElement);
    expect(mx.sendMessage).toHaveBeenCalledOnce();
    act(() => screenConnections.at(-1)?.onDisconnected());
    await waitFor(() => findButton(container, 'Reconnect'));
    await click(findButton(container, 'Reconnect'));
    await waitFor(() => findButton(container, 'Take control'));
    expect(mx.sendMessage).toHaveBeenCalledOnce();
  });

  it.each([
    [403, 'This requester is not allowed to control this agent.'],
    [409, 'Another viewer currently has control.'],
  ])('preserves a bounded %i control error returned by the server', async (status, detail) => {
    const gateway = createGateway();
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/control') && JSON.parse(init?.body as string).action === 'take') {
        return jsonResponse(status, { detail });
      }
      return gateway(input, init);
    }) as unknown as typeof fetch;
    renderPanel({ request });
    await waitFor(() => findButton(container, 'Take control'));

    await click(findButton(container, 'Take control'));

    await waitFor(() => expect(container.textContent).toContain(detail));
    expect(container.textContent).not.toContain('The computer changed.');
  });

  it('shows an actionable retry after initial session creation fails', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { detail: 'Computer capacity is unavailable.' }))
      .mockImplementation(createGateway()) as unknown as typeof fetch;
    renderPanel({ request });

    await waitFor(() => expect(container.textContent).toContain('Computer unavailable'));
    expect(container.textContent).toContain('Computer capacity is unavailable.');

    await click(findButton(container, 'Reconnect'));
    await waitFor(() => findButton(container, 'Take control'));
  });

  it('disposes a session that arrives after its thread scope was replaced', async () => {
    let resolveOldSession: ((response: Response) => void) | undefined;
    let createCount = 0;
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      if (init?.method === 'POST' && url.pathname === '/api/computers/sessions') {
        createCount += 1;
        if (createCount === 1) {
          return new Promise<Response>((resolve) => {
            resolveOldSession = resolve;
          });
        }
        return jsonResponse(200, makeStatus('session-new'));
      }
      if (init?.method === 'POST' && url.pathname.endsWith('/stream-ticket')) {
        return jsonResponse(200, { ticket: 'ticket-new', expires_at: 2_000_000_000 });
      }
      if (init?.method === 'DELETE') return jsonResponse(204);
      return jsonResponse(404, { detail: 'Not found' });
    }) as unknown as typeof fetch;
    const initial = renderPanel({ request });
    await waitFor(() => expect(createCount).toBe(1));

    act(() => root.render(<ComputerPanel {...initial} threadId="$replacement" />));
    await waitFor(() => expect(screenConnections).toHaveLength(1));
    expect(screenConnections[0].url).toContain('/sessions/session-new/stream');

    resolveOldSession?.(jsonResponse(200, makeStatus('session-old')));
    await waitFor(() =>
      expect(
        vi
          .mocked(request)
          .mock.calls.some(
            ([url, init]) =>
              url.toString().endsWith('/sessions/session-old') && init?.method === 'DELETE'
          )
      ).toBe(true)
    );
    expect(screenConnections).toHaveLength(1);
  });

  it.each([
    ['account', { mx: makeMatrixClient('@bob:example.org') }],
    ['room', { roomId: '!other:example.org' }],
    ['thread', { threadId: '$other-thread' }],
    ['agent', { agents: [{ userId: '@mindroom_writer:example.org', name: 'Writer' }] }],
  ])('closes the previous connection and session when the %s changes', async (_label, change) => {
    const request = createGateway();
    const initial = renderPanel({ request });
    await waitFor(() => findButton(container, 'Take control'));

    act(() => root.render(<ComputerPanel {...initial} {...change} />));
    await waitFor(() => expect(screenConnections).toHaveLength(2));

    expect(screenDisposals).toHaveBeenCalled();
    await waitFor(() =>
      expect(
        vi
          .mocked(request)
          .mock.calls.some(
            ([url, init]) =>
              url.toString().endsWith('/sessions/session-1') && init?.method === 'DELETE'
          )
      ).toBe(true)
    );
  });
});
