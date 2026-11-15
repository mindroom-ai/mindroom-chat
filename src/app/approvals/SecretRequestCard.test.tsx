// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientSessions, MindroomServerError } from '../computer/clientSessions';
import type { SecretRequest } from '../matrix/protocol/secretRequest';
import { SecretRequestCard } from './SecretRequestCard';

const ROOM = '!room:example.org';
const ALICE = '@alice:example.org';
const BOB = '@bob:example.org';
const API_URL = 'https://mindroom.example.org';
const PATH = '/api/rooms/!room%3Aexample.org/secret-requests/req-1';

const env = vi.hoisted(() => ({
  viewer: '@alice:example.org',
  server: { apiUrl: 'https://mindroom.example.org' as string | undefined, pending: false },
  send: vi.fn(),
  clientSessions: vi.fn(),
}));
const mx = vi.hoisted(() => ({
  getUserId: () => env.viewer,
  getRoom: () => ({
    getMember: (userId: string) => (userId === '@alice:example.org' ? { name: 'Alice' } : null),
    getJoinedMembers: () => [],
  }),
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../computer/useRoomMindroomServer', () => ({
  useRoomMindroomServer: () => env.server,
}));
vi.mock('../computer/clientSessions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../computer/clientSessions')>()),
  clientSessions: (...args: unknown[]) => env.clientSessions(...args),
}));

const request = (overrides: Partial<SecretRequest> = {}): SecretRequest => ({
  requestId: 'req-1',
  requesterId: ALICE,
  service: 'github',
  displayName: 'GitHub',
  hosts: ['api.github.com', 'uploads.github.com'],
  reason: 'To open the pull request.',
  status: 'pending',
  expiresAt: Date.now() + 15 * 60_000,
  ...overrides,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  env.viewer = ALICE;
  env.server = { apiUrl: API_URL, pending: false };
  env.send.mockReset();
  env.clientSessions.mockReset();
  env.clientSessions.mockImplementation(() => ({ send: env.send }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = (value: SecretRequest = request()) => {
  act(() => root.render(<SecretRequestCard request={value} roomId={ROOM} />));
};

const input = () => host.querySelector('input');
const button = (label: string) =>
  [...host.querySelectorAll('button')].find((node) => node.textContent === label);
const text = () => host.textContent ?? '';

const type = (value: string) => {
  const field = input();
  if (!field) throw new Error('no input');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setValue?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

/** What Enter in the field does: submits its form. */
const pressEnter = async () => {
  const form = input()?.closest('form');
  if (!form) throw new Error('no form');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
};

/** Lets an answered request and its body reach the card. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const answer = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('SecretRequestCard', () => {
  it('names the service, the reason and the hosts the key goes to', () => {
    render();

    expect(text()).toContain('GitHub key');
    expect(text()).toContain('To open the pull request.');
    expect(text()).toContain('Used only for api.github.com, uploads.github.com');
  });

  it('gives the requester a masked field with Save and Decline', () => {
    render();

    const field = input();
    expect(field?.type).toBe('password');
    expect(field?.getAttribute('autocomplete')).toBe('off');
    expect(field?.getAttribute('spellcheck')).toBe('false');
    expect(button('Save')).toBeDefined();
    expect(button('Decline')).toBeDefined();
    expect(text()).toContain('Waiting for you');
  });

  it('shows anyone else who it waits for, with no field', () => {
    env.viewer = BOB;
    render();

    expect(text()).toContain('Waiting for Alice');
    expect(input()).toBeNull();
    expect(button('Save')).toBeUndefined();
    expect(button('Decline')).toBeUndefined();
  });

  it.each([
    ['saved', 'Saved'],
    ['declined', 'Declined'],
    ['expired', 'Expired'],
  ] as const)('shows a %s request with its chip and no field', (status, chip) => {
    render(request({ status }));

    expect(host.querySelector('[data-secret-request-status]')?.textContent).toBe(chip);
    expect(input()).toBeNull();
    expect(button('Save')).toBeUndefined();
  });

  it('saves the typed key on the room server with Enter', async () => {
    env.send.mockResolvedValue(answer(204));
    render();
    type('ghp_secret');

    await pressEnter();

    expect(env.clientSessions).toHaveBeenCalledWith(mx, API_URL);
    expect(env.send).toHaveBeenCalledTimes(1);
    expect(env.send).toHaveBeenCalledWith(PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: 'ghp_secret' }),
    });
  });

  it('declines without a key', async () => {
    env.send.mockResolvedValue(answer(204));
    render();

    await act(async () => button('Decline')?.click());

    expect(env.send).toHaveBeenCalledWith(PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decline: true }),
    });
    await settle();
    expect(text()).toContain('Declined, waiting for the agent');
  });

  it('sends once when Save is pressed twice before the answer', async () => {
    let resolve!: (response: Response) => void;
    env.send.mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done;
      })
    );
    render();
    type('ghp_secret');

    await pressEnter();
    await pressEnter();
    resolve(answer(204));
    await settle();

    expect(env.send).toHaveBeenCalledTimes(1);
  });

  it('offers no Save until the key has text', () => {
    render();
    expect(button('Save')?.disabled).toBe(true);

    type('   ');
    expect(button('Save')?.disabled).toBe(true);

    type('ghp_secret');
    expect(button('Save')?.disabled).toBe(false);
  });

  it('drops the key after a 204 and says it waits for the agent', async () => {
    env.send.mockResolvedValue(answer(204));
    render();
    type('ghp_secret');

    await pressEnter();
    await settle();

    expect(text()).toContain('Saved, waiting for the agent');
    expect(input()).toBeNull();
    expect(host.innerHTML).not.toContain('ghp_secret');
  });

  it('drops the key after a 404 and says the request is gone', async () => {
    env.send.mockResolvedValue(answer(404, { detail: 'This request is no longer active.' }));
    render();
    type('ghp_secret');

    await pressEnter();
    await settle();

    expect(text()).toContain('This request is no longer active. Ask the agent again.');
    expect(input()).toBeNull();
    expect(host.innerHTML).not.toContain('ghp_secret');
  });

  it.each([
    [403, 'Only the person the agent asked can answer.'],
    [403, 'You can no longer set keys for this agent.'],
    [422, 'Secret contains invalid control character (ord 9)'],
  ])('shows the detail of a %i (%s) and keeps the key', async (status, detail) => {
    env.send.mockResolvedValue(answer(status, { detail }));
    render();
    type('ghp_secret');

    await pressEnter();
    await settle();

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(detail);
    expect(input()?.value).toBe('ghp_secret');
  });

  it('keeps the key for a retry when MindRoom cannot be reached', async () => {
    env.send.mockRejectedValue(new MindroomServerError('MindRoom could not be reached.', 0));
    render();
    type('ghp_secret');

    await pressEnter();
    await settle();

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't reach the server. Check your connection and try again."
    );
    expect(input()?.value).toBe('ghp_secret');
    expect(button('Save')?.disabled).toBe(false);
  });

  it('says entering keys is not available without a MindRoom server for the room', () => {
    env.server = { apiUrl: undefined, pending: false };
    render();

    expect(text()).toContain('Entering keys is not available on this server.');
    expect(input()).toBeNull();
  });

  it('holds Save while the room server is still being found', async () => {
    env.server = { apiUrl: undefined, pending: true };
    render();
    type('ghp_secret');

    expect(button('Save')?.disabled).toBe(true);
    expect(button('Decline')?.disabled).toBe(true);
    await pressEnter();
    expect(env.send).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the homeserver does not bind sign-in tokens',
      () =>
        Promise.reject(
          new Error('The homeserver does not bind sign-in tokens, so this server is not trusted.')
        ),
      () => answer(204),
    ],
    [
      'MindRoom refuses the sign-in',
      () =>
        Promise.resolve({
          access_token: 'openid',
          token_type: 'Bearer',
          matrix_server_name: 'example.org',
          expires_in: 3600,
        }),
      (url: string) =>
        url.endsWith('/api/client-sessions')
          ? answer(403, { detail: 'Token audience does not match.' })
          : answer(204),
    ],
  ])(
    'says entering keys is not available and keeps the key when %s',
    async (_case, getOpenIdToken, respond) => {
      const fetchStub = vi.fn(async (url: RequestInfo | URL) => respond(String(url)));
      env.clientSessions.mockImplementation(
        (_mx: unknown, apiUrl: string) =>
          new ClientSessions({ apiUrl, getOpenIdToken, request: fetchStub })
      );
      render();
      type('ghp_secret');

      await pressEnter();
      await settle();

      expect(host.querySelector('[role="alert"]')?.textContent).toBe(
        'Entering keys is not available on this server.'
      );
      expect(input()?.value).toBe('ghp_secret');
      // The key never left: no request reached the route.
      expect(fetchStub.mock.calls.map(([url]) => String(url))).not.toContain(`${API_URL}${PATH}`);
    }
  );

  it('flips a pending card to expired at its deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
    render(request({ expiresAt: Date.now() + 1_000 }));
    expect(input()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(host.querySelector('[data-secret-request-status]')?.textContent).toBe('Expired');
    expect(input()).toBeNull();
  });
});
