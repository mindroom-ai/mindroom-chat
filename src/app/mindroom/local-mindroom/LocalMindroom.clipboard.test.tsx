// @vitest-environment jsdom

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PairingCommandCopyButton } from './LocalMindroom';

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn<(text: string) => Promise<boolean>>(),
}));

vi.mock('folds', async () => ({
  ...(await vi.importActual<typeof import('folds')>('folds')),
  Button: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('button', props, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', null, children),
}));

vi.mock('../../components/page', () => ({
  Page: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
  PageContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
  PageHeader: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../components/sequence-card', () => ({
  SequenceCard: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../components/setting-tile', () => ({
  SettingTile: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../features/settings/styles.css', () => ({
  SequenceCardStyle: 'SequenceCardStyle',
}));

vi.mock('../../utils/dom', () => ({
  copyToClipboard: mocks.copyToClipboard,
}));

const buttonText = (renderer: ReactTestRenderer): string =>
  renderer.root.findByType('button').findByType('span').children.join('');

describe('PairingCommandCopyButton', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows Copied only after confirmed clipboard success', async () => {
    mocks.copyToClipboard.mockResolvedValue(true);
    const renderer = create(<PairingCommandCopyButton command="mindroom pair ABC123" />);

    await act(async () => {
      await renderer.root.findByType('button').props.onClick();
    });

    expect(mocks.copyToClipboard).toHaveBeenCalledWith('mindroom pair ABC123');
    expect(buttonText(renderer)).toBe('Copied');
    renderer.unmount();
  });

  it('keeps Copy Command visible when every clipboard path fails', async () => {
    mocks.copyToClipboard.mockResolvedValue(false);
    const renderer = create(<PairingCommandCopyButton command="mindroom pair ABC123" />);

    await act(async () => {
      await renderer.root.findByType('button').props.onClick();
    });

    expect(buttonText(renderer)).toBe('Copy Command');
    renderer.unmount();
  });
});
