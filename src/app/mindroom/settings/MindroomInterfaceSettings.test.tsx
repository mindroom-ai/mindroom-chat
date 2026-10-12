import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  settings: {
    simpleMode: false,
    longMessageFolding: 'auto' as 'auto' | 'on' | 'off',
    showCanvasesInSidebar: true,
  },
  clientConfig: {} as { mindroom?: { canvas?: { enabled?: boolean } } },
  setAccountSettings: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../hooks/useClientConfig', () => ({ useClientConfig: () => state.clientConfig }));

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Box: ({ children, ...rest }: { children?: React.ReactNode }) =>
      reactModule.createElement('div', rest, children),
    Button: ({
      children,
      onClick,
      'aria-label': ariaLabel,
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
      'aria-label'?: string;
    }) =>
      reactModule.createElement(
        'button',
        { 'data-menu-trigger': true, 'aria-label': ariaLabel, onClick },
        children
      ),
    Icon: () => null,
    Icons: { ChevronBottom: 'chevron-bottom' },
    PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
      anchor ? content : null,
    config: { space: { S100: '4px' } },
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

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock('../../components/glass/GlassPrimitives', () => ({
  Menu: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { role: 'menu' }, children),
  MenuItem: ({
    children,
    onClick,
    variant,
    role,
    'aria-checked': ariaChecked,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    role?: string;
    'aria-checked'?: boolean;
  }) =>
    React.createElement(
      'button',
      { 'data-menu-item': variant, role, 'aria-checked': ariaChecked, onClick },
      children
    ),
}));

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
  state.settings.longMessageFolding = 'auto';
  state.settings.showCanvasesInSidebar = true;
  state.clientConfig = {};
  state.setAccountSettings.mockReset();
  state.setAccountSettings.mockResolvedValue(undefined);
});

describe('MindroomInterfaceSettings', () => {
  it('offers long-message folding as an account-level choice, Auto by default', async () => {
    const { MindroomInterfaceSettings } = await import('./MindroomInterfaceSettings');
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(React.createElement(MindroomInterfaceSettings));
    });

    const tile = renderer.root.findByProps({ 'data-title': 'Fold long messages' });
    expect(tile.props['data-description']).toContain('Show full message');
    const trigger = tile.findByProps({ 'data-menu-trigger': true });
    expect(trigger.findByType('span').children).toEqual(['Auto']);
    expect(trigger.props['aria-label']).toBe('Fold long messages: Auto');
  });

  it('writes the chosen folding mode and shows it before the write settles', async () => {
    const { MindroomInterfaceSettings } = await import('./MindroomInterfaceSettings');
    let renderer!: ReactTestRenderer;
    state.setAccountSettings.mockReturnValue(new Promise<void>(() => {}));

    act(() => {
      renderer = create(React.createElement(MindroomInterfaceSettings));
    });
    const tile = renderer.root.findByProps({ 'data-title': 'Fold long messages' });
    act(() => {
      tile.findByProps({ 'data-menu-trigger': true }).props.onClick({
        currentTarget: { getBoundingClientRect: () => ({}) },
      });
    });
    const items = tile.findAll((node) => node.type === 'button' && 'data-menu-item' in node.props);
    expect(items.map((item) => item.props['data-menu-item'])).toEqual([
      'Primary',
      'Surface',
      'Surface',
    ]);
    expect(items.map((item) => [item.props.role, item.props['aria-checked']])).toEqual([
      ['menuitemradio', true],
      ['menuitemradio', false],
      ['menuitemradio', false],
    ]);

    await act(async () => {
      items[2].props.onClick();
    });

    expect(state.setAccountSettings).toHaveBeenCalledWith({ longMessageFolding: 'off' });
    expect(tile.findByProps({ 'data-menu-trigger': true }).findByType('span').children).toEqual([
      'Off',
    ]);
    expect(tile.findAll((node) => 'data-menu-item' in node.props)).toHaveLength(0);
  });

  it('offers the sidebar Canvases button only where the deployment has canvases', async () => {
    const { MindroomInterfaceSettings } = await import('./MindroomInterfaceSettings');
    const title = { 'data-title': 'Show Canvases in the sidebar' };
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(React.createElement(MindroomInterfaceSettings));
    });
    expect(renderer.root.findAllByProps(title)).toHaveLength(0);

    state.clientConfig = { mindroom: { canvas: { enabled: true } } };
    act(() => {
      renderer.update(React.createElement(MindroomInterfaceSettings));
    });
    const tile = renderer.root.findByProps(title);
    expect(tile.findByType('button').props['aria-pressed']).toBe(true);
    await act(async () => {
      tile.findByType('button').props.onClick();
    });
    expect(state.setAccountSettings).toHaveBeenCalledWith({ showCanvasesInSidebar: false });
  });
});
