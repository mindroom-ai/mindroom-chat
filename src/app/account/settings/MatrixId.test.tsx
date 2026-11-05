// @vitest-environment jsdom

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixId } from './MatrixId';

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn<() => Promise<boolean>>(),
}));

vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
  Chip: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('button', props, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', null, children),
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@alice:example.org' }),
}));

vi.mock('../../ui/sequence-card/SequenceCard', () => ({
  SequenceCard: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../ui/setting-tile/SettingTile', () => ({
  SettingTile: ({ title, after }: { title: string; after?: React.ReactNode }) =>
    React.createElement('div', null, title, after),
}));

vi.mock('../../ui/settings/styles.css', () => ({
  SequenceCardStyle: 'SequenceCardStyle',
}));

vi.mock('../../lib/dom', () => ({
  copyToClipboard: mocks.copyToClipboard,
}));

const buttonText = (renderer: ReactTestRenderer): string =>
  renderer.root.findByType('button').findByType('span').children.join('');

describe('MatrixId', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows confirmation only after the Matrix ID was copied', async () => {
    mocks.copyToClipboard.mockResolvedValue(true);
    const renderer = create(<MatrixId />);

    expect(buttonText(renderer)).toBe('Copy');

    await act(async () => {
      await renderer.root.findByType('button').props.onClick();
    });

    expect(mocks.copyToClipboard).toHaveBeenCalledWith('@alice:example.org');
    expect(buttonText(renderer)).toBe('Copied');
    renderer.unmount();
  });

  it('does not claim success when every clipboard path fails', async () => {
    mocks.copyToClipboard.mockResolvedValue(false);
    const renderer = create(<MatrixId />);

    await act(async () => {
      await renderer.root.findByType('button').props.onClick();
    });

    expect(buttonText(renderer)).toBe('Copy');
    renderer.unmount();
  });
});
