// @vitest-environment jsdom
import React, { type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegistrationInvite } from './invites';
import { RegistrationInvites } from './RegistrationInvites';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  invite: vi.fn(),
  remove: vi.fn(),
  providers: vi.fn(),
  rooms: vi.fn(),
  copy: vi.fn(),
  client: {
    getRoom: (roomId: string) => (roomId === '!lobby:example.com' ? { name: 'Lobby' } : null),
  },
}));

vi.mock('folds', () => {
  const tag =
    (name: string) =>
    ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => {
      const kept = Object.fromEntries(
        Object.entries(props).filter(
          ([key]) => /^(data-|aria-)/.test(key) || ['onClick', 'disabled', 'role'].includes(key)
        )
      );
      return React.createElement(name, kept, children);
    };
  return {
    Badge: tag('mark'),
    Box: tag('div'),
    Button: tag('button'),
    Chip: tag('button'),
    Icon: tag('i'),
    IconButton: tag('button'),
    Icons: {},
    Spinner: () => React.createElement('progress'),
    Switch: ({ value, onChange }: { value: boolean; onChange: (on: boolean) => void }) =>
      React.createElement('input', { type: 'checkbox', checked: value, onChange }),
    Text: tag('span'),
    TextArea: ({ value, onChange }: { value: string; onChange: () => void }) =>
      React.createElement('textarea', { value, onChange }),
    color: { Critical: { Main: 'red' }, Success: { Main: 'green' } },
  };
});
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mocks.client }));
vi.mock('../lib/dom', () => ({ copyToClipboard: mocks.copy }));
vi.mock('../ui/SettingTile', () => ({
  SettingTile: ({ title, description, after, children }: Record<string, ReactNode>) =>
    React.createElement('section', null, title, description, after, children),
}));
vi.mock('../ui/settings/SettingsCard', () => ({
  SettingsCard: ({ children }: { children: ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('../ui/ActionDialog', () => ({
  ActionDialog: ({ label, children }: { label: string; children: ReactNode }) =>
    React.createElement('dialog', { 'aria-label': label }, children),
}));
vi.mock('../ui/ErrorDetail', () => ({ ErrorDetail: () => null }));
vi.mock('./invites', async (original) => ({
  ...(await original<typeof import('./invites')>()),
  listInvites: mocks.list,
  inviteAddresses: mocks.invite,
  deleteInvite: mocks.remove,
  ssoProviderNames: mocks.providers,
  invitableRooms: mocks.rooms,
  chatUrl: () => 'https://chat.example.com/',
}));

const ALICE: RegistrationInvite = {
  email: 'alice@example.com',
  rooms: ['!lobby:example.com', '#other:example.com'],
  external: true,
};
const BOB: RegistrationInvite = { email: 'bob@example.com', rooms: [], external: false };

const inUse = Object.assign(new Error('refused'), {
  errcode: 'M_THREEPID_IN_USE',
  httpStatus: 400,
  data: {
    errcode: 'M_THREEPID_IN_USE',
    error: 'That email address already belongs to @bob:example.com.',
  },
});

let renderer: ReactTestRenderer | undefined;

const render = async (invites: RegistrationInvite[]) => {
  mocks.list.mockResolvedValue(invites);
  await act(async () => {
    renderer = create(<RegistrationInvites />);
  });
  return renderer!.root;
};

const text = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : text(child))).join(' ');
const withProp = (root: ReactTestInstance, prop: string, value?: string) => {
  const found = root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      node.props[prop] !== undefined &&
      (value === undefined || node.props[prop] === value)
  );
  if (found.length !== 1) throw new Error(`${found.length} elements with ${prop}`);
  return found[0]!;
};
const click = (node: ReactTestInstance) =>
  act(async () => {
    (node.props.onClick as () => void)();
  });
const dialogs = (root: ReactTestInstance) => root.findAllByType('dialog');

const INVITATION =
  'You are invited to https://chat.example.com/. Sign in with Example ID, using exactly this email address: alice@example.com';

beforeEach(() => {
  mocks.providers.mockResolvedValue(['Example ID']);
  mocks.rooms.mockReturnValue([
    { roomId: '!class:example.com', name: 'Class' },
    { roomId: '!lobby:example.com', name: 'Lobby' },
  ]);
  mocks.remove.mockResolvedValue(undefined);
  mocks.copy.mockResolvedValue(true);
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.clearAllMocks();
});

describe('RegistrationInvites', () => {
  it('lists each pending invite with its rooms by name and whether it is external', async () => {
    const root = await render([ALICE, BOB]);

    expect(text(root)).toContain('alice@example.com');
    expect(text(root)).toContain('Lobby · #other:example.com');
    expect(text(root)).toContain('bob@example.com');
    expect(root.findAllByType('mark').map(text)).toEqual(['External']);
    expect(text(root)).not.toContain('No pending invites');
    expect(root.findAllByProps({ role: 'alert' })).toEqual([]);
  });

  it('says so when no invite is pending', async () => {
    const root = await render([]);

    expect(text(root)).toContain('No pending invites');
  });

  it('offers to load again when the invites cannot be read', async () => {
    mocks.list.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      renderer = create(<RegistrationInvites />);
    });
    const { root } = renderer!;

    expect(text(root)).toContain("Couldn't load the invites.");
    mocks.list.mockResolvedValue([BOB]);
    await click(root.findAllByType('button').find((entry) => text(entry) === 'Retry')!);
    expect(text(root)).toContain('bob@example.com');
    expect(root.findAllByProps({ role: 'alert' })).toEqual([]);
  });

  it('copies the invitation of a pending invite', async () => {
    const root = await render([ALICE]);

    await click(withProp(root, 'data-copy-invitation', 'alice@example.com'));

    expect(mocks.copy).toHaveBeenCalledWith(INVITATION);
    expect(text(withProp(root, 'data-copy-invitation'))).toBe('Copied');
  });

  it('asks before it deletes an invite, naming the address, and reads the list again', async () => {
    const root = await render([ALICE, BOB]);

    await click(withProp(root, 'data-invite-delete', 'alice@example.com'));
    expect(text(dialogs(root)[0]!)).toContain('Delete the invite for alice@example.com?');
    expect(mocks.remove).not.toHaveBeenCalled();

    mocks.list.mockResolvedValue([BOB]);
    await click(withProp(root, 'data-confirm-delete'));

    expect(mocks.remove).toHaveBeenCalledWith(mocks.client, 'alice@example.com');
    expect(dialogs(root)).toEqual([]);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(text(root)).not.toContain('alice@example.com');
  });

  it('deletes nothing when the confirmation is cancelled', async () => {
    const root = await render([ALICE]);

    await click(withProp(root, 'data-invite-delete'));
    await click(
      dialogs(root)[0]!
        .findAllByType('button')
        .find((entry) => text(entry) === 'Cancel')!
    );

    expect(dialogs(root)).toEqual([]);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('keeps the confirmation open with the error when the server refuses to delete', async () => {
    mocks.remove.mockRejectedValue(
      Object.assign(new Error('refused'), { errcode: 'M_FORBIDDEN', httpStatus: 403 })
    );
    const root = await render([ALICE]);

    await click(withProp(root, 'data-invite-delete'));
    await click(withProp(root, 'data-confirm-delete'));

    expect(dialogs(root)).toHaveLength(1);
    expect(withProp(dialogs(root)[0]!, 'role', 'alert')).toBeDefined();
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it('invites every pasted address with the chosen rooms, and shows what became of each', async () => {
    mocks.invite.mockResolvedValue([
      { address: 'Alice@example.com', invite: { ...ALICE, rooms: ['!lobby:example.com'] } },
      { address: 'bob@example.com', error: inUse },
      {
        address: 'nodomain',
        error: Object.assign(new Error('refused'), { errcode: 'M_INVALID_PARAM' }),
      },
    ]);
    const root = await render([]);

    await click(withProp(root, 'data-invite-add'));
    const dialog = dialogs(root)[0]!;
    const send = () => withProp(dialog, 'data-invite-send');

    // External is on until the administrator turns it off.
    expect(dialog.findByType('input').props.checked).toBe(true);
    expect(send().props.disabled).toBe(true);

    await act(async () => {
      dialog.findByType('textarea').props.onChange({
        currentTarget: { value: 'Alice@example.com, bob@example.com\nnodomain' },
      });
    });
    await click(withProp(dialog, 'data-invite-room', '!lobby:example.com'));
    expect(withProp(dialog, 'data-invite-room', '!lobby:example.com').props['aria-pressed']).toBe(
      true
    );
    expect(send().props.disabled).toBe(false);
    await click(send());

    expect(mocks.invite).toHaveBeenCalledWith(
      mocks.client,
      ['Alice@example.com', 'bob@example.com', 'nodomain'],
      ['!lobby:example.com'],
      true
    );
    expect(text(withProp(dialog, 'data-invite-result', 'Alice@example.com'))).toContain('Invited');
    expect(text(withProp(dialog, 'data-invite-result', 'Alice@example.com'))).toContain(INVITATION);
    expect(text(withProp(dialog, 'data-invite-result', 'bob@example.com'))).toContain(
      '@bob:example.com already has this address.'
    );
    expect(text(withProp(dialog, 'data-invite-result', 'nodomain'))).toContain(
      'This is not a valid email address.'
    );
    expect(dialog.findAllByType('textarea')).toEqual([]);
    // The list behind the dialog reads the invites again.
    expect(mocks.list).toHaveBeenCalledTimes(2);

    await click(withProp(dialog, 'data-copy-invitation', 'alice@example.com'));
    expect(mocks.copy).toHaveBeenCalledWith(INVITATION);

    await click(dialog.findAllByType('button').find((entry) => text(entry) === 'Done')!);
    expect(dialogs(root)).toEqual([]);
  });

  it('invites a normal account when External is turned off', async () => {
    mocks.invite.mockResolvedValue([{ address: 'bob@example.com', invite: BOB }]);
    const root = await render([]);

    await click(withProp(root, 'data-invite-add'));
    const dialog = dialogs(root)[0]!;
    await act(async () => {
      (dialog.findByType('input').props.onChange as (on: boolean) => void)(false);
      dialog.findByType('textarea').props.onChange({ currentTarget: { value: 'bob@example.com' } });
    });
    await click(withProp(dialog, 'data-invite-send'));

    expect(mocks.invite).toHaveBeenCalledWith(mocks.client, ['bob@example.com'], [], false);
  });
});
