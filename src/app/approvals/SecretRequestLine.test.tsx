// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../config/useClientConfig';
import type {
  KeySecretRequest,
  SecretRequest,
  TemporarySecretRequest,
} from '../matrix/protocol/secretRequest';
import { SecretRequestLine } from './SecretRequestLine';

const ROOM = '!room:example.org';
const ALICE = '@alice:example.org';
const AGENT = '@mindroom_assistant:example.org';
const CONFIGURED = 'https://configured.example.org';

const env = vi.hoisted(() => ({ viewer: '@alice:example.org', send: vi.fn() }));
const mx = vi.hoisted(() => ({
  getUserId: () => env.viewer,
  getRoom: () => ({
    getMember: (userId: string) =>
      ({ '@mindroom_assistant:example.org': { name: 'Ada' } }[userId] ?? null),
    getJoinedMembers: () => [],
  }),
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../computer/useAgentServers', () => ({
  useOpenIdBinding: () => true,
  useRoomAgentServers: () => [],
}));
vi.mock('../computer/clientSessions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../computer/clientSessions')>()),
  clientSessions: () => ({ send: env.send }),
}));

const temporary = (overrides: Partial<TemporarySecretRequest> = {}): SecretRequest => ({
  kind: 'temporary',
  requestId: 'req-1',
  requesterId: ALICE,
  env: 'HETZNER_SUDO_PASSWORD',
  keep: { memory: 900, disk: 28_800 },
  kept: null,
  reason: 'sudo on hetzner-matrix to pull the provisioning checkout.',
  status: 'pending',
  expiresAt: Date.now() + 9 * 60_000,
  ...overrides,
});

const key = (overrides: Partial<KeySecretRequest> = {}): SecretRequest => ({
  kind: 'key',
  requestId: 'req-1',
  requesterId: ALICE,
  service: 'hetzner',
  displayName: 'Hetzner Cloud key',
  hosts: ['api.hetzner.cloud'],
  replaces: true,
  reason: 'Read-only token to list snapshots.',
  status: 'saved',
  expiresAt: Date.now() + 9 * 60_000,
  ...overrides,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  env.viewer = ALICE;
  env.send.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = (request: SecretRequest) =>
  act(() =>
    root.render(
      <ClientConfigProvider value={{ mindroom: { computers: { apiUrl: CONFIGURED } } }}>
        <SecretRequestLine request={request} roomId={ROOM} agentUserId={AGENT} />
      </ClientConfigProvider>
    )
  );

const line = () => host.querySelector('[data-secret-request-line]');
/** The line itself, without the card under it. */
const row = () => line()?.firstElementChild;
const lineButton = () => line()?.querySelector(':scope > button');
const field = () => host.querySelector<HTMLInputElement>('input:not([type="radio"])');
const receipt = () => host.querySelector('[data-secret-request-receipt]');
const text = () => host.textContent ?? '';
const click = (element: Element | null | undefined) =>
  act(() => {
    if (!element) throw new Error('nothing to click');
    (element as HTMLElement).click();
  });

describe('SecretRequestLine', () => {
  it('waits on a line that opens nothing, the form under it', () => {
    render(temporary());

    expect(line()?.getAttribute('data-secret-request-line')).toBe('pending');
    expect(lineButton()).toBeNull();
    expect(row()?.textContent).toBe('HETZNER_SUDO_PASSWORD' + 'Expires in 9 minutes');
    expect(field()).not.toBeNull();
    expect(text()).toContain('sudo on hetzner-matrix');
    expect(host.querySelector('button[type="submit"]')?.textContent).toBe('Send');
    // A status line that stays through the answer, for screen readers.
    expect(host.querySelector('[role="status"]')).not.toBeNull();
  });

  it('names a temporary secret by its label when the agent gave one', () => {
    render(temporary({ label: 'Hetzner sudo password' }));
    expect(row()?.textContent).toBe('Hetzner sudo password' + 'Expires in 9 minutes');
  });

  it('offers no field to someone else, who sees whom it waits for', () => {
    env.viewer = '@bob:example.org';
    render(temporary());
    expect(field()).toBeNull();
    expect(text()).toContain('Waiting for');
  });

  it('closes once done to a line with a chevron, which opens the request read-only and folds it', () => {
    render(temporary({ status: 'saved', kept: 'memory' }));

    expect(line()?.getAttribute('data-secret-request-line')).toBe('saved');
    expect(row()?.textContent).toBe('HETZNER_SUDO_PASSWORD' + 'Sent · kept 15 minutes');
    expect(field()).toBeNull();
    expect(receipt()).toBeNull();
    expect(lineButton()?.getAttribute('aria-expanded')).toBe('false');

    click(lineButton());
    expect(lineButton()?.getAttribute('aria-expanded')).toBe('true');
    const opened = receipt()?.textContent ?? '';
    expect(opened).toContain('Sent');
    expect(opened).toContain('sudo on hetzner-matrix to pull the provisioning checkout.');
    expect(opened).toContain("Given to Ada's commands in this conversation as");
    expect(opened).toContain('Kept for 15 minutes, in memory only.');
    expect(opened).toContain('Sent to configured.example.org');
    expect(receipt()?.querySelector('input, button')).toBeNull();

    click(lineButton());
    expect(receipt()).toBeNull();
  });

  it.each([
    ['declined', 'Declined', 'Nothing was sent or kept.'],
    ['expired', 'Expired', 'No answer in time, so nothing was sent.'],
  ] as const)(
    'says what a %s request did, and that nothing went anywhere',
    (status, word, fact) => {
      render(temporary({ status }));
      expect(row()?.textContent).toBe(`HETZNER_SUDO_PASSWORD${word}`);
      click(lineButton());
      expect(receipt()?.textContent).toContain(fact);
      expect(receipt()?.textContent).toContain("Asked for Ada's commands");
      expect(receipt()?.textContent).not.toContain('Sent to');
    }
  );

  it('names a key by its service and lists its hosts and the key it replaced', () => {
    render(key());
    expect(row()?.textContent).toBe('Hetzner Cloud keySaved');
    click(lineButton());
    const opened = receipt()?.textContent ?? '';
    expect(opened).toContain('Used only for api.hetzner.cloud');
    expect(opened).toContain('Replaced the key saved before.');
  });

  it('turns done with the answer, before the agent edits the card', async () => {
    env.send.mockResolvedValue(new Response(null, { status: 200 }));
    render(temporary());
    const input = field()!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      setValue?.call(input, 'hunter2');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input
        .closest('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(env.send).toHaveBeenCalledTimes(1);
    expect(line()?.getAttribute('data-secret-request-line')).toBe('saved');
    expect(field()).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Sent, waiting for the agent');
    // From the keyboard, the line takes the focus the form had.
    expect(document.activeElement).toBe(lineButton());
  });
});
