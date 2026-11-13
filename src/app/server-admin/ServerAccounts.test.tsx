// @vitest-environment jsdom
import React, { type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerAccount } from './accounts';
import { ServerAccounts } from './ServerAccounts';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  rooms: vi.fn(),
  run: vi.fn(),
  client: { getUserId: () => '@alice:example.com' },
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
    Icons: {},
    Input: ({ value, onChange }: { value: string; onChange: () => void }) =>
      React.createElement('input', { value, onChange }),
    Spinner: () => React.createElement('progress'),
    Text: tag('span'),
    color: { Critical: { Main: 'red' } },
  };
});
vi.mock('./ServerAccounts.css', () => ({ AccountRow: 'AccountRow' }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mocks.client }));
vi.mock('../ui/SettingTile', () => ({
  SettingTile: ({ title, description, after, children }: Record<string, ReactNode>) =>
    React.createElement('section', null, title, description, after, children),
}));
vi.mock('../ui/settings/SettingsCard', () => ({
  SettingsCard: ({ children }: { children: ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('../ui/settings/SettingsPageFrame', () => ({
  SettingsPageFrame: ({ children }: { children: ReactNode }) =>
    React.createElement('main', null, children),
}));
vi.mock('../ui/ActionDialog', () => ({
  ActionDialog: ({ label, children }: { label: string; children: ReactNode }) =>
    React.createElement('dialog', { 'aria-label': label }, children),
}));
vi.mock('../ui/ErrorDetail', () => ({ ErrorDetail: () => null }));
vi.mock('./accounts', async (original) => ({
  ...(await original<typeof import('./accounts')>()),
  listServerAccounts: mocks.list,
  getServerAccount: mocks.get,
  listAccountRooms: mocks.rooms,
  runAccountAction: mocks.run,
}));

const account = (userId: string, fields: Partial<ServerAccount> = {}): ServerAccount => ({
  userId,
  admin: false,
  deactivated: false,
  locked: false,
  external: false,
  ...fields,
});

const ALICE = account('@alice:example.com', { displayName: 'Alice', admin: true });
const BOB = account('@bob:example.com', { displayName: 'Bob' });
const CAROL = account('@carol:example.com', { displayName: 'Carol', external: true });
const DAVE = account('@dave:example.com', { deactivated: true });

let renderer: ReactTestRenderer | undefined;

const render = async (accounts: ServerAccount[]) => {
  mocks.list.mockResolvedValue(accounts);
  mocks.get.mockImplementation(async (_mx: unknown, userId: string) => ({
    ...accounts.find((entry) => entry.userId === userId),
    suspended: false,
  }));
  await act(async () => {
    renderer = create(<ServerAccounts requestClose={() => undefined} />);
  });
  return renderer!.root;
};

const text = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : text(child))).join(' ');
const buttons = (root: ReactTestInstance) => root.findAllByType('button');
const button = (root: ReactTestInstance, label: string) => {
  const found = buttons(root).find((entry) => text(entry) === label);
  if (!found) throw new Error(`no button "${label}"`);
  return found;
};
const click = (node: ReactTestInstance) =>
  act(async () => {
    (node.props.onClick as () => void)();
  });
const rows = (root: ReactTestInstance) =>
  root.findAll((node) => node.type === 'button' && node.props['data-account'] !== undefined);
const rowIds = (root: ReactTestInstance) => rows(root).map((row) => row.props['data-account']);
const filterLabels = (root: ReactTestInstance) =>
  root
    .findAll((node) => node.type === 'button' && node.props['aria-pressed'] !== undefined)
    .map(text);

beforeEach(() => {
  mocks.rooms.mockResolvedValue([{ roomId: '!lobby:example.com', name: 'Lobby' }]);
  mocks.run.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.clearAllMocks();
});

describe('ServerAccounts', () => {
  it('lists every account, without the external badge and filters when the server marks none', async () => {
    const root = await render([ALICE, BOB, DAVE]);

    expect(rowIds(root)).toEqual(['@alice:example.com', '@bob:example.com', '@dave:example.com']);
    expect(filterLabels(root)).toEqual(['All', 'Deactivated']);
    expect(text(root)).toContain('Accounts: 3 of 3');
    expect(text(root)).not.toContain('External');
    expect(root.findAllByProps({ role: 'alert' })).toEqual([]);
    expect(text(rows(root)[0]!)).toContain('Admin');
    expect(text(rows(root)[2]!)).toContain('Deactivated');
    // Each row shows that it opens.
    rows(root).forEach((row) => expect(row.findAllByType('i')).toHaveLength(1));
  });

  it('marks external accounts and filters by them when the server says which they are', async () => {
    const root = await render([ALICE, BOB, CAROL, DAVE]);

    expect(filterLabels(root)).toEqual(['All', 'Internal', 'External', 'Deactivated']);
    expect(text(rows(root)[2]!)).toContain('External');

    await click(button(root, 'External'));
    expect(rowIds(root)).toEqual(['@carol:example.com']);
    await click(button(root, 'Internal'));
    expect(rowIds(root)).toEqual(['@alice:example.com', '@bob:example.com', '@dave:example.com']);
    await click(button(root, 'Deactivated'));
    expect(rowIds(root)).toEqual(['@dave:example.com']);
  });

  it('searches names and Matrix IDs', async () => {
    const root = await render([ALICE, BOB, CAROL]);

    await act(async () => {
      root.findByType('input').props.onChange({ currentTarget: { value: 'caro' } });
    });

    expect(rowIds(root)).toEqual(['@carol:example.com']);
    expect(text(root)).toContain('Accounts: 1 of 3');
  });

  it('says so when the accounts do not load, and loads them on Retry', async () => {
    mocks.list.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      renderer = create(<ServerAccounts requestClose={() => undefined} />);
    });
    const { root } = renderer!;
    expect(text(root.findByProps({ role: 'alert' }))).toContain("Couldn't load the accounts.");

    mocks.list.mockResolvedValue([BOB]);
    await click(button(root, 'Retry'));

    expect(rowIds(root)).toEqual(['@bob:example.com']);
    expect(root.findAllByProps({ role: 'alert' })).toEqual([]);
  });

  it('shows an account with its rooms and acts only after a confirmation that names it', async () => {
    const root = await render([ALICE, BOB]);
    await click(rows(root)[1]!);

    expect(mocks.get).toHaveBeenCalledWith(mocks.client, '@bob:example.com');
    expect(text(root)).toContain('Lobby');
    expect(buttons(root).map(text)).toEqual([
      'Back',
      'Lock account',
      'Suspend account',
      'Deactivate account',
    ]);
    // Each action says what it does before it is chosen.
    expect(text(root)).toContain('A locked account cannot be used at all.');
    expect(text(root)).toContain('A suspended account can still sign in and read');
    expect(text(root)).toContain('can never sign in again. This cannot be undone.');

    await click(button(root, 'Deactivate account'));
    const dialog = root.findByType('dialog');
    expect(text(dialog)).toContain('Deactivate @bob:example.com?');
    expect(text(dialog)).toContain('This cannot be undone.');
    expect(mocks.run).not.toHaveBeenCalled();

    await click(button(dialog, 'Cancel'));
    expect(root.findAllByType('dialog')).toEqual([]);
    expect(mocks.run).not.toHaveBeenCalled();

    await click(button(root, 'Lock account'));
    expect(text(root.findByType('dialog'))).toContain('Lock @bob:example.com?');
    mocks.list.mockResolvedValue([ALICE, { ...BOB, locked: true }]);
    mocks.get.mockResolvedValue({ ...BOB, locked: true, suspended: false });
    await click(button(root.findByType('dialog'), 'Lock account'));

    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledWith(mocks.client, '@bob:example.com', 'lock');
    expect(root.findAllByType('dialog')).toEqual([]);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(buttons(root).map(text)).toContain('Unlock account');
  });

  it('keeps the confirmation open with the reason when the server refuses', async () => {
    const root = await render([ALICE, BOB]);
    await click(rows(root)[1]!);
    mocks.run.mockRejectedValue(new Error('refused'));

    await click(button(root, 'Suspend account'));
    await click(button(root.findByType('dialog'), 'Suspend account'));

    expect(root.findByType('dialog').findAllByProps({ role: 'alert' }).length).toBeGreaterThan(0);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it('offers no action on what an action made stale when the account does not load again', async () => {
    const root = await render([ALICE, BOB]);
    await click(rows(root)[1]!);
    mocks.get.mockRejectedValue(new Error('offline'));

    await click(button(root, 'Lock account'));
    await click(button(root.findByType('dialog'), 'Lock account'));

    expect(buttons(root).map(text)).toEqual(['Back']);
    expect(root.findAllByProps({ role: 'alert' }).length).toBeGreaterThan(0);
  });

  it('keeps the latest list when an earlier load answers last', async () => {
    const root = await render([ALICE, BOB]);
    await click(rows(root)[1]!);
    let answerLocked: (accounts: ServerAccount[]) => void = () => undefined;
    mocks.list.mockReturnValueOnce(
      new Promise<ServerAccount[]>((resolve) => {
        answerLocked = resolve;
      })
    );
    mocks.get.mockResolvedValue({ ...BOB, locked: true, suspended: false });
    await click(button(root, 'Lock account'));
    await click(button(root.findByType('dialog'), 'Lock account'));

    mocks.get.mockResolvedValue({ ...BOB, suspended: false });
    await click(button(root, 'Unlock account'));
    await click(button(root.findByType('dialog'), 'Unlock account'));
    await act(async () => answerLocked([ALICE, { ...BOB, locked: true }]));

    await click(button(root, 'Back'));
    expect(text(rows(root)[1]!)).not.toContain('Locked');
  });

  it('offers no action on the own account, an administrator or a deactivated account', async () => {
    const root = await render([ALICE, DAVE]);
    await click(rows(root)[0]!);
    expect(buttons(root).map(text)).toEqual(['Back']);
    expect(text(root)).toContain('Administrators and your own account cannot be changed here.');

    await click(button(root, 'Back'));
    await click(rows(root)[1]!);
    expect(buttons(root).map(text)).toEqual(['Back']);
    expect(text(root)).not.toContain('cannot be changed here');
  });

  it('still shows the account when its rooms do not load', async () => {
    mocks.rooms.mockRejectedValue(new Error('M_FORBIDDEN'));
    const root = await render([ALICE, BOB]);
    await click(rows(root)[1]!);

    expect(text(root)).toContain("Couldn't load this account's rooms.");
    expect(buttons(root).map(text)).toContain('Lock account');
  });
});
