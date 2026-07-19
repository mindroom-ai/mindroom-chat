import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  settings: {
    simpleMode: false,
    expandLongMessagesByDefault: false,
  },
  setAccountSettings: vi.fn(() => Promise.resolve()),
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Box: ({ children, ...rest }: { children?: React.ReactNode }) =>
      reactModule.createElement('div', rest, children),
    Switch: ({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) =>
      reactModule.createElement('button', {
        'aria-pressed': value,
        onClick: () => onChange(!value),
      }),
    Text: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
    color: { Critical: { Main: 'red' } },
  };
});

vi.mock('../../components/sequence-card', () => ({
  SequenceCard: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('section', null, children),
}));

vi.mock('../../components/setting-tile', () => ({
  SettingTile: ({
    title,
    description,
    after,
    children,
  }: {
    title: string;
    description?: string;
    after?: React.ReactNode;
    children?: React.ReactNode;
  }) =>
    React.createElement(
      'label',
      {
        'data-title': title,
        'data-description': description,
      },
      after,
      children
    ),
}));

vi.mock('./useMindroomAccountSettings', () => ({
  useMindroomAccountSettings: () => state.settings,
  useSetMindroomAccountSettings: () => state.setAccountSettings,
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

afterEach(() => {
  state.settings.simpleMode = false;
  state.settings.expandLongMessagesByDefault = false;
  state.setAccountSettings.mockReset();
  state.setAccountSettings.mockResolvedValue(undefined);
});

describe('MindroomInterfaceSettings', () => {
  it('renders the folded-message default as an account-level interface option', async () => {
    const { MindroomInterfaceSettings } = await import('./MindroomInterfaceSettings');
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(React.createElement(MindroomInterfaceSettings));
    });

    const tile = renderer.root.findByProps({
      'data-title': 'Expand long messages by default',
    });
    expect(tile.props['data-description']).toContain('Show more');
    expect(tile.findByType('button').props['aria-pressed']).toBe(false);
  });

  it('writes the expanded-message preference when toggled', async () => {
    const { MindroomInterfaceSettings } = await import('./MindroomInterfaceSettings');
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(React.createElement(MindroomInterfaceSettings));
    });
    const tile = renderer.root.findByProps({
      'data-title': 'Expand long messages by default',
    });

    await act(async () => {
      tile.findByType('button').props.onClick();
    });

    expect(state.setAccountSettings).toHaveBeenCalledWith({
      expandLongMessagesByDefault: true,
    });
  });
});
