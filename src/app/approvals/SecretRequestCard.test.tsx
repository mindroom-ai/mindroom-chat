// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import { ClientSessions, MindroomServerError } from '../computer/clientSessions';
import type { AgentServer } from '../computer/agentServer';
import type { SecretRequest } from '../matrix/protocol/secretRequest';
import { SecretRequestCard } from './SecretRequestCard';
import * as css from './SecretRequestCard.css';

const ROOM = '!room:example.org';
const ALICE = '@alice:example.org';
const BOB = '@bob:example.org';
const AGENT = '@mindroom_assistant:example.org';
const OTHER_AGENT = '@mindroom_helper:example.org';
const AGENT_SERVER = 'https://agent.example.org';
const OTHER_SERVER = 'https://other.example.org';
const CONFIGURED = 'https://configured.example.org';
const PATH = '/api/rooms/!room%3Aexample.org/secret-requests/req-1';

type Computers = NonNullable<NonNullable<ClientConfig['mindroom']>['computers']>;

const published = (agentUserId: string, apiUrl: string, ts: number): AgentServer => ({
  agentUserId,
  apiUrl,
  computer: false,
  ts,
});

const env = vi.hoisted(() => ({
  viewer: '@alice:example.org',
  // What the homeserver answered on binding tokens; undefined while it has not.
  binding: true as boolean | undefined,
  // The servers the room's agents published, newest first.
  published: [] as AgentServer[],
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
vi.mock('../computer/useAgentServers', () => ({
  useOpenIdBinding: () => env.binding,
  useRoomAgentServers: () => env.published,
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
// The deployment's `mindroom.computers`; none by default, as in production Chat.
let computers: Computers = {};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Without a trusted list, published servers are used unchecked, which the console says once.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  env.viewer = ALICE;
  env.binding = true;
  env.published = [published(AGENT, AGENT_SERVER, 1)];
  computers = {};
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
  vi.mocked(console.warn).mockRestore();
});

const render = (value: SecretRequest = request()) => {
  act(() =>
    root.render(
      <ClientConfigProvider value={{ mindroom: { computers } }}>
        <SecretRequestCard request={value} roomId={ROOM} agentUserId={AGENT} />
      </ClientConfigProvider>
    )
  );
};

const input = () => host.querySelector('input');
const button = (label: string) =>
  [...host.querySelectorAll('button')].find(
    (node) => node.textContent === label || node.getAttribute('aria-label') === label
  );
const text = () => host.textContent ?? '';
const chip = () => host.querySelector('[data-secret-request-status]')?.textContent;
const status = () => host.querySelector('[role="status"]');

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

/** Saves `key` and lets the answer arrive. */
const save = async (key = 'ghp_secret') => {
  type(key);
  await pressEnter();
  await settle();
};

describe('SecretRequestCard', () => {
  it('names the service, the reason, the hosts the key goes to and the time left', () => {
    render();

    expect(text()).toContain('GitHub key');
    expect(text()).toContain('To open the pull request.');
    expect(text()).toContain('Used only for api.github.com, uploads.github.com');
    expect(text()).toContain('expires in 15 minutes');
  });

  it('gives the requester a masked text field that is no sign-in field, with Save and Decline', () => {
    render();

    const field = input();
    expect(field?.type).toBe('text');
    expect(field?.parentElement?.classList.contains(css.Masked)).toBe(true);
    expect(field?.getAttribute('autocomplete')).toBe('off');
    expect(field?.getAttribute('autocorrect')).toBe('off');
    expect(field?.getAttribute('autocapitalize')).toBe('off');
    expect(field?.getAttribute('spellcheck')).toBe('false');
    expect(field?.hasAttribute('data-1p-ignore')).toBe(true);
    expect(field?.getAttribute('data-lpignore')).toBe('true');
    expect(field?.hasAttribute('data-bwignore')).toBe(true);
    expect(field?.getAttribute('data-form-type')).toBe('other');
    expect(host.querySelector('input[type="password"]')).toBeNull();
    expect(button('Save')).toBeDefined();
    expect(button('Decline')).toBeDefined();
    expect(chip()).toBe('Waiting for you');
  });

  it('shows and hides the key', () => {
    render();

    act(() => button('Show key')?.click());
    expect(input()?.parentElement?.classList.contains(css.Masked)).toBe(false);
    expect(button('Hide key')?.getAttribute('aria-pressed')).toBe('true');

    act(() => button('Hide key')?.click());
    expect(input()?.parentElement?.classList.contains(css.Masked)).toBe(true);
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
  ] as const)('shows a %s request with its chip, no field and no time left', (value, label) => {
    render(request({ status: value }));

    expect(chip()).toBe(label);
    expect(input()).toBeNull();
    expect(button('Save')).toBeUndefined();
    expect(text()).not.toContain('expires');
  });

  describe("the asking agent's own server", () => {
    it('takes the key though another agent published a newer server', async () => {
      env.published = [published(OTHER_AGENT, OTHER_SERVER, 2), published(AGENT, AGENT_SERVER, 1)];
      env.send.mockResolvedValue(answer(204));
      render();

      await save();

      expect(env.clientSessions).toHaveBeenCalledTimes(1);
      expect(env.clientSessions).toHaveBeenCalledWith(mx, AGENT_SERVER);
    });

    it('takes the key when the deployment trusts it beside its configured one', async () => {
      computers = { apiUrl: CONFIGURED, trustedApiUrls: [AGENT_SERVER, OTHER_SERVER] };
      env.published = [published(OTHER_AGENT, OTHER_SERVER, 2), published(AGENT, AGENT_SERVER, 1)];
      env.send.mockResolvedValue(answer(204));
      render();

      await save();

      expect(env.clientSessions).toHaveBeenCalledWith(mx, AGENT_SERVER);
    });

    it("is never another agent's: without its own or a configured one, keys cannot be entered", () => {
      env.published = [published(OTHER_AGENT, OTHER_SERVER, 2)];
      render();

      expect(text()).toContain('Entering keys is not available on this server.');
      expect(input()).toBeNull();
    });

    it('is the configured one while the homeserver does not bind tokens', async () => {
      env.binding = false;
      computers = { apiUrl: CONFIGURED };
      env.send.mockResolvedValue(answer(204));
      render();

      await save();

      expect(env.clientSessions).toHaveBeenCalledWith(mx, CONFIGURED);
    });

    it('is the configured one when the published one is not trusted', async () => {
      computers = { apiUrl: CONFIGURED };
      env.send.mockResolvedValue(answer(204));
      render();

      await save();

      expect(env.clientSessions).toHaveBeenCalledWith(mx, CONFIGURED);
    });

    it('holds Save until the homeserver answers on binding tokens', async () => {
      env.binding = undefined;
      render();
      type('ghp_secret');

      expect(button('Save')?.disabled).toBe(true);
      expect(button('Decline')?.disabled).toBe(true);
      await pressEnter();
      expect(env.send).not.toHaveBeenCalled();
    });
  });

  it('saves the typed key with Enter', async () => {
    env.send.mockResolvedValue(answer(204));
    render();
    type('ghp_secret');

    await pressEnter();

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
    expect(status()?.textContent).toBe('Declined, waiting for the agent');
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

  it('keeps one empty status region mounted while the card is open', () => {
    render();

    expect(status()).not.toBeNull();
    expect(status()?.textContent).toBe('');
  });

  it('drops the key after a 204, says it waits for the agent and moves focus there', async () => {
    env.send.mockResolvedValue(answer(204));
    render();
    type('ghp_secret');
    input()?.focus();

    await pressEnter();
    await settle();

    expect(status()?.textContent).toBe('Saved, waiting for the agent');
    expect(document.activeElement).toBe(status());
    expect(chip()).toBe('Saved');
    expect(input()).toBeNull();
    expect(host.innerHTML).not.toContain('ghp_secret');
  });

  it('keeps saying it waits for the agent after the deadline passes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
    env.send.mockResolvedValue(answer(204));
    const value = request({ expiresAt: Date.now() + 60_000 });
    render(value);
    await save();

    vi.setSystemTime(new Date('2026-11-15T12:05:00Z'));
    render({ ...value });

    expect(chip()).toBe('Saved');
    expect(status()?.textContent).toBe('Saved, waiting for the agent');
  });

  it('drops the key after a 404 and says the request is gone', async () => {
    env.send.mockResolvedValue(answer(404, { detail: 'This request is no longer active.' }));
    render();

    await save();

    expect(status()?.textContent).toBe('This request is no longer active. Ask the agent again.');
    expect(input()).toBeNull();
    expect(host.innerHTML).not.toContain('ghp_secret');
  });

  it('hands the status over to the agent once its edit arrives', async () => {
    env.send.mockResolvedValue(answer(204));
    const value = request();
    render(value);
    await save();

    render({ ...value, status: 'saved' });

    expect(chip()).toBe('Saved');
    expect(status()).toBeNull();
  });

  it.each([
    [403, 'Only the person the agent asked can answer.'],
    [403, 'You can no longer set keys for this agent.'],
    [422, 'Secret contains invalid control character (ord 9)'],
  ])('shows the detail of a %i (%s) and keeps the key', async (code, detail) => {
    env.send.mockResolvedValue(answer(code, { detail }));
    render();

    await save();

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(detail);
    expect(input()?.value).toBe('ghp_secret');
  });

  it('keeps the key for a retry when MindRoom cannot be reached', async () => {
    env.send.mockRejectedValue(new MindroomServerError('MindRoom could not be reached.', 0));
    render();

    await save();

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't reach the server. Check your connection and try again."
    );
    expect(input()?.value).toBe('ghp_secret');
    expect(button('Save')?.disabled).toBe(false);
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

      await save();

      expect(host.querySelector('[role="alert"]')?.textContent).toBe(
        'Entering keys is not available on this server.'
      );
      expect(input()?.value).toBe('ghp_secret');
      // The key never left: no request reached the route.
      expect(fetchStub.mock.calls.map(([url]) => String(url))).not.toContain(
        `${AGENT_SERVER}${PATH}`
      );
    }
  );

  it('counts the time left down and flips a pending card to expired at its deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
    render(request({ expiresAt: Date.now() + 2 * 60_000 }));
    expect(text()).toContain('expires in 2 minutes');

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(text()).toContain('expires in 1 minute');
    expect(input()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(chip()).toBe('Expired');
    expect(input()).toBeNull();
    expect(status()).toBeNull();
    expect(text()).not.toContain('expires');
  });
});
