// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import { computerServicePreferenceAtom } from '../computer/computerServiceSettings';
import { ClientSessions, MindroomServerError } from '../computer/clientSessions';
import type { AgentServer } from '../computer/agentServer';
import type {
  KeySecretRequest,
  SecretRequest,
  TemporarySecretRequest,
} from '../matrix/protocol/secretRequest';
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
const PERSONAL = 'https://personal.example.org';
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
    getMember: (userId: string) =>
      ({ '@alice:example.org': { name: 'Alice' }, '@mindroom_assistant:example.org': { name: 'Ada' } })[
        userId
      ] ?? null,
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

const request = (overrides: Partial<KeySecretRequest> = {}): SecretRequest => ({
  kind: 'key',
  requestId: 'req-1',
  requesterId: ALICE,
  service: 'github',
  displayName: 'GitHub',
  hosts: ['api.github.com', 'uploads.github.com'],
  replaces: false,
  reason: 'To open the pull request.',
  status: 'pending',
  expiresAt: Date.now() + 15 * 60_000,
  ...overrides,
});

const temporary = (overrides: Partial<TemporarySecretRequest> = {}): SecretRequest => ({
  kind: 'temporary',
  requestId: 'req-1',
  requesterId: ALICE,
  env: 'SUDO_PASSWORD',
  keep: { memory: 900, disk: 86_400 },
  kept: null,
  reason: 'To restart the web server.',
  status: 'pending',
  expiresAt: Date.now() + 15 * 60_000,
  ...overrides,
});

let host: HTMLDivElement;
let root: Root;
// The deployment's `mindroom.computers`.
let computers: Computers = {};
/** The person's MindRoom server on this device: null follows the deployment, '' turns it off. */
const setPersonalServer = (value: string | null) =>
  getDefaultStore().set(computerServicePreferenceAtom, value);

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  env.viewer = ALICE;
  env.binding = true;
  // By default the agent published nothing and the deployment names its server.
  env.published = [];
  computers = { apiUrl: CONFIGURED };
  setPersonalServer(null);
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
  setPersonalServer(null);
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

const input = () => host.querySelector<HTMLInputElement>('input:not([type="radio"])');
const button = (label: string) =>
  [...host.querySelectorAll('button')].find(
    (node) => node.textContent === label || node.getAttribute('aria-label') === label
  );
const text = () => host.textContent ?? '';
const chip = () => host.querySelector('[data-secret-request-status]')?.textContent;
const status = () => host.querySelector('[role="status"]');
const card = () => host.querySelector('[aria-label="Key request"]');

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

const radio = (keep: string) => host.querySelector<HTMLInputElement>(`input[type="radio"][value="${keep}"]`);
const sentBody = (): unknown => JSON.parse(env.send.mock.calls[0]?.[1]?.body as string);

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

  it('keeps the typed key out of the markup and out of React state', () => {
    render();

    type('ghp_secret');

    expect(input()?.value).toBe('ghp_secret');
    expect(input()?.hasAttribute('value')).toBe(false);
    expect(host.innerHTML).not.toContain('ghp_secret');
    expect(button('Save')?.disabled).toBe(false);
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

  describe('where the key goes', () => {
    const destination = async () => {
      env.send.mockResolvedValue(answer(204));
      render();
      await save();
      expect(env.clientSessions).toHaveBeenCalledTimes(1);
      return env.clientSessions.mock.calls[0]?.[1] as string;
    };

    const expectNoField = () => {
      expect(input()).toBeNull();
      expect(text()).toContain('Entering keys is not available on this server.');
      expect(text()).toContain(
        'To enter keys here, set your MindRoom server in Settings → Computers → Computer service URL.'
      );
      expect(env.clientSessions).not.toHaveBeenCalled();
    };

    // Production Chat names no server and trusts no list, so any `mindroom_` account could publish
    // an origin and post a card for someone: a token bound to that origin is useless elsewhere, a
    // key is not.
    it('never goes to a published server nobody chose, and names none', () => {
      computers = {};
      env.published = [published(AGENT, AGENT_SERVER, 1)];
      render();

      expectNoField();
      expect(text()).not.toContain('agent.example.org');
    });

    it("has no fallback when the agent's own server is not chosen", () => {
      env.published = [published(AGENT, AGENT_SERVER, 1)];
      render();

      expectNoField();
    });

    it("goes to the agent's server when it is the person's own", async () => {
      computers = {};
      setPersonalServer(AGENT_SERVER);
      env.published = [published(AGENT, AGENT_SERVER, 1)];

      expect(await destination()).toBe(AGENT_SERVER);
    });

    it("goes to the agent's server on the trusted list, though another agent published a newer one", async () => {
      computers = { apiUrl: CONFIGURED, trustedApiUrls: [AGENT_SERVER, OTHER_SERVER] };
      env.published = [published(OTHER_AGENT, OTHER_SERVER, 2), published(AGENT, AGENT_SERVER, 1)];

      expect(await destination()).toBe(AGENT_SERVER);
    });

    it("goes to the deployment's server when the agent published none, not another agent's", async () => {
      env.published = [published(OTHER_AGENT, OTHER_SERVER, 2)];

      expect(await destination()).toBe(CONFIGURED);
    });

    it("goes to the person's server when the deployment names none", async () => {
      computers = {};
      setPersonalServer(PERSONAL);

      expect(await destination()).toBe(PERSONAL);
    });

    it("goes to the deployment's server while the homeserver does not bind tokens", async () => {
      env.binding = false;
      env.published = [published(AGENT, AGENT_SERVER, 1)];

      expect(await destination()).toBe(CONFIGURED);
    });

    it('goes nowhere when nothing is named and the person turned their server off', () => {
      computers = {};
      setPersonalServer('');
      render();

      expectNoField();
    });

    it("names its host on the requester's card", () => {
      render();

      expect(text()).toContain('Sent to configured.example.org');
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
      redirect: 'error',
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
      redirect: 'error',
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

  it('drops the key after a 204 and says it waits for the agent', async () => {
    env.send.mockResolvedValue(answer(204));
    render();

    await save();

    expect(status()?.textContent).toBe('Saved, waiting for the agent');
    expect(chip()).toBe('Saved');
    expect(input()).toBeNull();
    expect(host.innerHTML).not.toContain('ghp_secret');
  });

  describe('focus', () => {
    /** A response the test answers when it likes, as a slow server does. */
    const deferred = () => {
      let resolve!: (response: Response) => void;
      env.send.mockReturnValue(
        new Promise<Response>((done) => {
          resolve = done;
        })
      );
      return async (response: Response) => {
        resolve(response);
        await settle();
      };
    };

    /** A key press on a focused button: a click with no pointer (`detail` 0). */
    const pressKeyOn = async (label: string) => {
      const target = button(label);
      if (!target) throw new Error(`no ${label}`);
      act(() => target.focus());
      await act(async () => {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
    };

    it.each([
      ['Save', 'Saved, waiting for the agent', 'saved'],
      ['Decline', 'Declined, waiting for the agent', 'declined'],
    ] as const)(
      'keeps keyboard focus on %s while busy, then gives it to the card through the edit',
      async (label, waiting, final) => {
        const respond = deferred();
        const focus = vi.spyOn(HTMLElement.prototype, 'focus');
        const value = request();
        render(value);
        type('ghp_secret');

        await pressKeyOn(label);

        // Busy, not disabled: a disabled button would drop the focus to the page.
        expect(button(label)?.getAttribute('aria-disabled')).toBe('true');
        expect(button(label)?.disabled).toBe(false);
        expect(document.activeElement).toBe(button(label));
        await respond(answer(204));
        expect(status()?.textContent).toBe(waiting);
        expect(document.activeElement).toBe(card());
        expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
        render({ ...value, status: final });
        expect(document.activeElement).toBe(card());
        focus.mockRestore();
      }
    );

    it('ignores a click on a busy button', async () => {
      deferred();
      render();
      type('ghp_secret');

      await pressKeyOn('Save');
      await act(async () => button('Save')?.click());
      await act(async () => button('Decline')?.click());

      expect(env.send).toHaveBeenCalledTimes(1);
    });

    it('gives keyboard focus to the card when the agent edit comes before the response', async () => {
      const respond = deferred();
      const value = request();
      render(value);
      type('ghp_secret');
      act(() => input()?.focus());
      await pressEnter();

      render({ ...value, status: 'saved' });
      expect(document.activeElement).toBe(card());
      await respond(answer(204));

      expect(chip()).toBe('Saved');
      expect(document.activeElement).toBe(card());
    });

    /** Focuses the field, as typing in it does, and counts the blurs it gets. */
    const focusField = () => {
      const field = input();
      if (!field) throw new Error('no input');
      const blurred = vi.fn();
      field.addEventListener('blur', blurred);
      act(() => field.focus());
      return blurred;
    };

    // Safari and iOS leave the focus in the field when a pointer clicks or taps Save, and the field
    // matches :focus-visible, so where focus sits cannot tell a tap from Enter.
    it('blurs the field after an answer by pointer and gives the card no focus', async () => {
      env.send.mockResolvedValue(answer(204));
      render();
      type('ghp_secret');
      const blurred = focusField();

      await act(async () => {
        button('Save')?.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
        );
      });
      await settle();

      expect(env.send).toHaveBeenCalledTimes(1);
      expect(status()?.textContent).toBe('Saved, waiting for the agent');
      expect(blurred).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(document.body);
    });

    it("blurs the field when the agent's edit comes with no answer on its way", () => {
      const value = request();
      render(value);
      const blurred = focusField();

      render({ ...value, status: 'saved' });

      expect(blurred).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(document.body);
    });

    it('blurs the field at the deadline and gives the card no focus', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
      render(request({ expiresAt: Date.now() + 1_000 }));
      const blurred = focusField();

      act(() => {
        vi.advanceTimersByTime(1_000);
      });

      expect(chip()).toBe('Expired');
      expect(blurred).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(document.body);
    });

    it('leaves keyboard focus on Save after an error to retry from', async () => {
      const respond = deferred();
      render();
      type('ghp_secret');

      await pressKeyOn('Save');
      await respond(answer(503));

      expect(host.querySelector('[role="alert"]')?.textContent).toBe(
        'The server ran into a problem. Try again later.'
      );
      expect(document.activeElement).toBe(button('Save'));
      expect(button('Save')?.hasAttribute('aria-disabled')).toBe(false);
    });

    it('leaves focus where the person moved it during the request', async () => {
      const respond = deferred();
      const composer = document.createElement('textarea');
      document.body.append(composer);
      render();
      type('ghp_secret');
      await pressKeyOn('Save');

      act(() => composer.focus());
      await respond(answer(204));

      expect(status()?.textContent).toBe('Saved, waiting for the agent');
      expect(document.activeElement).toBe(composer);
      composer.remove();
    });
  });

  it('refuses a redirect, which would replay the key to another origin, and keeps the key', async () => {
    // As a browser does: `redirect: 'error'` fails the request on the 307; following it would
    // send the body to the other origin, which answers 204.
    const elsewhere = vi.fn(() => answer(204));
    const fetchStub = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/api/client-sessions'))
        return Response.json({ session_token: 'session', expires_at: Date.now() / 1000 + 3600 });
      if (init?.redirect === 'error') throw new TypeError('Failed to fetch');
      return elsewhere();
    });
    env.clientSessions.mockImplementation(
      (_mx: unknown, apiUrl: string) =>
        new ClientSessions({
          apiUrl,
          getOpenIdToken: async () => ({
            access_token: 'openid',
            token_type: 'Bearer',
            matrix_server_name: 'example.org',
            expires_in: 3600,
          }),
          request: fetchStub,
        })
    );
    render();

    await save();

    expect(elsewhere).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't reach the server. Check your connection and try again."
    );
    expect(chip()).toBe('Waiting for you');
    expect(input()?.value).toBe('ghp_secret');
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

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(detail);
    expect(input()?.value).toBe('ghp_secret');
    // The field names the error as its description while it shows.
    expect(alert?.id).not.toBe('');
    expect(input()?.getAttribute('aria-describedby')).toBe(alert?.id);
    expect(input()?.getAttribute('aria-invalid')).toBe('true');
  });

  it('describes the field with no error before one shows', () => {
    render();

    expect(input()?.hasAttribute('aria-describedby')).toBe(false);
    expect(input()?.hasAttribute('aria-invalid')).toBe(false);
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
        `${CONFIGURED}${PATH}`
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
  it('says that saving replaces a key the service already has', () => {
    render(request({ replaces: true }));

    expect(text()).toContain('Replaces the key saved now.');
    expect(button('Replace key')).toBeDefined();
    expect(button('Save')).toBeUndefined();
  });

  it('says nothing of replacing when the service has no key', () => {
    render();

    expect(text()).not.toContain('Replaces');
    expect(button('Replace key')).toBeUndefined();
  });

  it('asks for a temporary secret with its variable and how long to keep it', () => {
    render(temporary());

    expect(host.querySelector('[aria-label="Secret request"]')).not.toBeNull();
    expect(card()).toBeNull();
    expect(text()).toContain('Secret for Ada');
    expect(text()).toContain('To restart the web server.');
    expect(text()).toContain("Given to Ada's commands in this conversation as SUDO_PASSWORD.");
    expect(text()).toContain('expires in 15 minutes');
    expect(text()).not.toContain('Used only for');
    expect(text()).not.toContain('key');
    expect(input()?.getAttribute('aria-label')).toBe('Secret for SUDO_PASSWORD');
    expect(input()?.getAttribute('placeholder')).toBe('Paste or type the secret');
    expect(input()?.parentElement?.classList.contains(css.Masked)).toBe(true);
    expect(host.querySelector('fieldset legend')?.textContent).toBe('Keep for');
    expect(radio('memory')?.checked).toBe(true);
    expect(radio('memory')?.closest('label')?.textContent).toBe('15 minutes, in memory only');
    expect(radio('disk')?.checked).toBe(false);
    expect(radio('disk')?.closest('label')?.textContent).toBe('24 hours, in a file on the server');
    expect(button('Send')).toBeDefined();
    expect(button('Save')).toBeUndefined();
    expect(button('Show secret')).toBeDefined();
    expect(chip()).toBe('Waiting for you');
  });

  it('offers only the keeps the card names', () => {
    render(temporary({ keep: { disk: 3_600 } }));

    expect(radio('memory')).toBeNull();
    expect(radio('disk')?.checked).toBe(true);
    expect(radio('disk')?.closest('label')?.textContent).toBe('1 hour, in a file on the server');
  });

  it('sends a temporary secret to be kept in memory unless the person chooses the file', async () => {
    env.send.mockResolvedValue(answer(204));
    render(temporary());
    type('hunter2');

    await pressEnter();

    expect(env.send).toHaveBeenCalledTimes(1);
    expect(env.send.mock.calls[0]?.[0]).toBe(PATH);
    expect(sentBody()).toEqual({ secret: 'hunter2', keep: 'memory' });
    await settle();
    expect(status()?.textContent).toBe('Sent, waiting for the agent');
    expect(chip()).toBe('Sent');
    expect(input()).toBeNull();
  });

  it('sends the keep the person chose', async () => {
    env.send.mockResolvedValue(answer(204));
    render(temporary());
    act(() => radio('disk')?.click());
    type('hunter2');

    await pressEnter();

    expect(radio('disk')?.checked ?? true).toBe(true);
    expect(sentBody()).toEqual({ secret: 'hunter2', keep: 'disk' });
  });

  it('declines a temporary secret with no keep', async () => {
    env.send.mockResolvedValue(answer(204));
    render(temporary());
    act(() => radio('disk')?.click());

    await act(async () => button('Decline')?.click());

    expect(sentBody()).toEqual({ decline: true });
  });

  it.each([
    ['memory', 'Kept for 15 minutes, in memory only.'],
    ['disk', 'Kept for 24 hours, in a file on the server.'],
  ] as const)('says how long an answered temporary secret is kept (%s)', (kept, line) => {
    render(temporary({ status: 'saved', kept }));

    expect(chip()).toBe('Sent');
    expect(text()).toContain(line);
    expect(input()).toBeNull();
    expect(radio('memory')).toBeNull();
  });

  it('shows anyone else who a temporary secret waits for, with no field or choice', () => {
    env.viewer = BOB;
    render(temporary());

    expect(text()).toContain('Waiting for Alice');
    expect(input()).toBeNull();
    expect(radio('memory')).toBeNull();
    expect(button('Send')).toBeUndefined();
  });
});
