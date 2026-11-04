// @vitest-environment jsdom

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContactInfo } from './ContactInfo';

const mocks = vi.hoisted(() => {
  const getThreePids =
    vi.fn<() => Promise<{ threepids: { medium: string; address: string }[] }>>();
  // One client for every render, as the provider gives: the effect depends on it.
  return { getThreePids, client: { getThreePids } };
});

vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
  Spinner: () => React.createElement('progress'),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', null, children),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key.split('.').pop() }),
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => mocks.client,
}));

vi.mock('../../../components/setting-tile', () => ({
  SettingTile: ({ title, children }: { title: string; children?: React.ReactNode }) =>
    React.createElement('section', { title }, children),
}));

vi.mock('../SettingsCard', () => ({
  SettingsCard: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

const tileText = (renderer: ReactTestRenderer): string[] =>
  renderer.root
    .findByType('section')
    .findAllByType('span')
    .map((node) => node.children.join(''));

const renderSettled = async (): Promise<ReactTestRenderer> => {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<ContactInfo />);
  });
  return renderer!;
};

describe('ContactInfo', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists the email addresses only', async () => {
    mocks.getThreePids.mockResolvedValue({
      threepids: [
        { medium: 'email', address: 'alice@example.org' },
        { medium: 'msisdn', address: '15550100' },
      ],
    });
    const renderer = await renderSettled();

    expect(tileText(renderer)).toEqual(['alice@example.org']);
    renderer.unmount();
  });

  it('keeps the section and says so when the account has no email', async () => {
    mocks.getThreePids.mockResolvedValue({ threepids: [] });
    const renderer = await renderSettled();

    expect(renderer.root.findByType('section').props.title).toBe('emailAddress');
    expect(tileText(renderer)).toEqual(['yourAccountDoesNotHaveAnyEmail']);
    renderer.unmount();
  });

  it('shows a spinner while the addresses load', () => {
    mocks.getThreePids.mockReturnValue(new Promise(() => undefined));
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(<ContactInfo />);
    });

    expect(renderer!.root.findAllByType('progress')).toHaveLength(1);
    renderer!.unmount();
  });

  it('leaves the section out when the server refuses the request', async () => {
    mocks.getThreePids.mockRejectedValue(new Error('M_UNRECOGNIZED'));
    const renderer = await renderSettled();

    expect(renderer.toJSON()).toBeNull();
    renderer.unmount();
  });
});
