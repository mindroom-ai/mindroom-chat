// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../../config/useClientConfig';
import { accountSettingsAtom } from '../../matrix/hooks/useAccountSettings';
import type { RegisteredPlugin } from '../../plugins/registry';
import type { AccountSettings } from '../../preferences/accountSettings';
import { Plugins } from './Plugins';

const mocks = vi.hoisted(() => ({
  plugins: [] as RegisteredPlugin[],
  setAccountSettings: vi.fn<(patch: Partial<AccountSettings>) => Promise<void>>(() =>
    Promise.resolve()
  ),
}));

vi.mock('../../plugins/registry', () => ({
  registeredPlugins: mocks.plugins,
}));

vi.mock('../../matrix/hooks/useAccountSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../matrix/hooks/useAccountSettings')>();
  return {
    ...actual,
    useSetAccountSettings: () => mocks.setAccountSettings,
  };
});

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

vi.mock('../../ui/settings/SettingsPageFrame', () => ({
  SettingsPageFrame: ({ title, children }: { title: string; children?: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));

vi.mock('../../ui/settings/SettingsCard', () => ({
  SettingsCard: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const makePlugin = (id: string, displayName: string, description?: string): RegisteredPlugin => ({
  id,
  tag: `${id}@1.0.0`,
  displayName,
  ...(description !== undefined ? { description } : {}),
  conversationCovers: [],
  messageRenderers: [],
  pages: [],
  roomHeaderSlot: [],
  threadHeaderSlot: [],
  sidePanels: [],
  headerActions: [],
  slashCommands: [],
  roomActions: [],
  messageLinks: [],
  threadCardBadges: [],
  threadDetails: [],
});

const renderPlugins = (
  deploymentConfig: ClientConfig = {},
  storedAccountSettings?: Record<string, unknown>
) => {
  const store = createStore();
  store.set(accountSettingsAtom, storedAccountSettings);
  const view = render(
    <Provider store={store}>
      <ClientConfigProvider value={deploymentConfig}>
        <Plugins requestClose={() => undefined} />
      </ClientConfigProvider>
    </Provider>
  );
  return { ...view, store };
};

afterEach(() => {
  cleanup();
  mocks.plugins.length = 0;
  mocks.setAccountSettings.mockReset();
  mocks.setAccountSettings.mockResolvedValue(undefined);
});

describe('Plugins settings page', () => {
  it('renders deployment-enabled plugins with display names and descriptions and excludes deployment-disabled plugins', () => {
    mocks.plugins.push(
      makePlugin('pull-requests', 'Pull Requests', 'Review pull requests in rooms'),
      makePlugin('thread-usage', 'Thread Usage'),
      makePlugin('blocked', 'Blocked Plugin', 'Hidden by deployment')
    );
    const deploymentConfig = {
      plugins: { blocked: { enabled: false } },
    } as unknown as ClientConfig;

    renderPlugins(deploymentConfig);

    expect(screen.getByText('Pull Requests')).toBeTruthy();
    expect(screen.getByText('Review pull requests in rooms')).toBeTruthy();
    expect(screen.getByText('Thread Usage')).toBeTruthy();
    expect(screen.queryByText('Blocked Plugin')).toBeNull();

    expect(screen.getByRole('switch', { name: 'Pull Requests' }).getAttribute('aria-checked')).toBe(
      'true'
    );
    expect(screen.getByRole('switch', { name: 'Thread Usage' }).getAttribute('aria-checked')).toBe(
      'true'
    );
  });

  it('writes disabledPlugins when toggled and keeps all deployment-enabled plugins visible when all are user-disabled', async () => {
    mocks.plugins.push(
      makePlugin('pull-requests', 'Pull Requests'),
      makePlugin('thread-usage', 'Thread Usage')
    );

    const { store } = renderPlugins({}, { disabledPlugins: ['pull-requests', 'thread-usage'] });

    const prSwitch = screen.getByRole('switch', { name: 'Pull Requests' });
    const usageSwitch = screen.getByRole('switch', { name: 'Thread Usage' });
    expect(prSwitch.getAttribute('aria-checked')).toBe('false');
    expect(usageSwitch.getAttribute('aria-checked')).toBe('false');

    mocks.setAccountSettings.mockImplementation(async (patch) => {
      store.set(accountSettingsAtom, {
        ...(store.get(accountSettingsAtom) ?? {}),
        ...patch,
      });
    });

    await act(async () => {
      fireEvent.click(prSwitch);
    });
    expect(mocks.setAccountSettings).toHaveBeenCalledWith({
      disabledPlugins: ['thread-usage'],
    });
    expect(prSwitch.getAttribute('aria-checked')).toBe('true');
    expect(usageSwitch.getAttribute('aria-checked')).toBe('false');
  });

  it('composes rapid consecutive toggles without clobbering earlier clicks', async () => {
    mocks.plugins.push(
      makePlugin('pull-requests', 'Pull Requests'),
      makePlugin('thread-usage', 'Thread Usage')
    );

    const resolvers: Array<() => void> = [];
    mocks.setAccountSettings.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        })
    );

    renderPlugins({});

    fireEvent.click(screen.getByRole('switch', { name: 'Pull Requests' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Thread Usage' }));

    expect(mocks.setAccountSettings).toHaveBeenNthCalledWith(1, {
      disabledPlugins: ['pull-requests'],
    });
    expect(mocks.setAccountSettings).toHaveBeenNthCalledWith(2, {
      disabledPlugins: ['pull-requests', 'thread-usage'],
    });

    await act(async () => {
      resolvers.forEach((resolve) => resolve());
    });
  });

  it('shows an error and reverts the switch when saving fails', async () => {
    mocks.plugins.push(makePlugin('pull-requests', 'Pull Requests'));
    mocks.setAccountSettings.mockRejectedValue(new Error('network'));

    renderPlugins({});
    const prSwitch = screen.getByRole('switch', { name: 'Pull Requests' });

    await act(async () => {
      fireEvent.click(prSwitch);
    });

    expect(prSwitch.getAttribute('aria-checked')).toBe('true');
    expect(
      screen.getByText('Could not save the change. Check your connection and try again.')
    ).toBeTruthy();
  });
});
