import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  settings: {
    showCanvasesInSidebar: true,
  },
  clientConfig: {},
  setAccountSettings: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../config/useClientConfig', () => ({ useClientConfig: () => state.clientConfig }));
vi.mock('../../local-mindroom/useShowLocalMindroom', () => ({ useShowLocalMindroom: () => false }));

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

vi.mock('../../ui/SequenceCard', () => ({
  SequenceCard: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('section', null, children),
}));

vi.mock('../../ui/SettingTile', () => ({
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

vi.mock('../../matrix/hooks/useAccountSettings', () => ({
  useAccountSettings: () => state.settings,
  useSetAccountSettings: () => state.setAccountSettings,
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

afterEach(() => {
  state.settings.showCanvasesInSidebar = true;
  state.clientConfig = {};
  state.setAccountSettings.mockReset();
  state.setAccountSettings.mockResolvedValue(undefined);
});

describe('AgentInterfaceSettings', () => {
  it('offers the sidebar Canvases button unless the deployment turns canvases off', async () => {
    state.clientConfig = { mindroom: { canvas: { enabled: false } } };
    const { AgentInterfaceSettings } = await import('./AgentInterfaceSettings');
    const title = { 'data-title': 'Show Canvases in the sidebar' };
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(React.createElement(AgentInterfaceSettings));
    });
    expect(renderer.root.findAllByProps(title)).toHaveLength(0);

    state.clientConfig = {};
    act(() => {
      renderer.update(React.createElement(AgentInterfaceSettings));
    });
    const tile = renderer.root.findByProps(title);
    expect(tile.findByType('button').props['aria-pressed']).toBe(true);
    await act(async () => {
      tile.findByType('button').props.onClick();
    });
    expect(state.setAccountSettings).toHaveBeenCalledWith({ showCanvasesInSidebar: false });
  });

  it('shows the toggled state optimistically, reverts with an error on failure, and hides the error on retry', async () => {
    let rejectFirst!: (error: unknown) => void;
    let resolveSecond!: () => void;
    state.setAccountSettings
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectFirst = reject;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSecond = resolve;
          })
      );

    const { AgentInterfaceSettings } = await import('./AgentInterfaceSettings');
    const title = { 'data-title': 'Show Canvases in the sidebar' };
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(React.createElement(AgentInterfaceSettings));
    });
    const tile = () => renderer.root.findByProps(title);
    const toggle = () => tile().findByType('button');

    await act(async () => {
      toggle().props.onClick();
    });
    expect(toggle().props['aria-pressed']).toBe(false);

    await act(async () => {
      rejectFirst(new Error('offline'));
    });
    expect(toggle().props['aria-pressed']).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain(
      'Could not save the change. Check your connection and try again.'
    );

    await act(async () => {
      toggle().props.onClick();
    });
    expect(toggle().props['aria-pressed']).toBe(false);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Could not save the change.');

    await act(async () => {
      state.settings.showCanvasesInSidebar = false;
      resolveSecond();
    });
    expect(toggle().props['aria-pressed']).toBe(false);
  });
});
