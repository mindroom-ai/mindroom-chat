import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  paginationLimit: 10000,
  setPaginationLimit: vi.fn(),
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) =>
      reactModule.createElement('input', props),
    Text: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
    toRem: (value: number) => `${value}px`,
  };
});

vi.mock('../../components/sequence-card', () => ({
  SequenceCard: ({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) => React.createElement('section', { className }, children),
}));

vi.mock('../../components/setting-tile', () => ({
  SettingTile: ({
    title,
    description,
    after,
  }: {
    title: string;
    description?: string;
    after?: React.ReactNode;
  }) =>
    React.createElement(
      'label',
      {
        'data-title': title,
        'data-description': description,
      },
      after
    ),
}));

vi.mock('../../state/hooks/settings', () => ({
  useSetting: () => [state.paginationLimit, state.setPaginationLimit],
}));

vi.mock('../../state/settings', () => ({
  settingsAtom: {},
}));

afterEach(() => {
  state.paginationLimit = 10000;
  state.setPaginationLimit.mockReset();
});

describe('MindroomMessagePreloadLimitSetting', () => {
  it('owns the MindRoom preload setting copy and styling seam', async () => {
    const { MindroomMessagePreloadLimitSetting } = await import(
      './MindroomMessagePreloadLimitSetting'
    );

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(
        React.createElement(MindroomMessagePreloadLimitSetting, { className: 'settings-card' })
      );
    });

    expect(renderer!.root.findByProps({ className: 'settings-card' })).toBeDefined();
    expect(renderer!.root.findByProps({ 'data-title': 'Message Preload Limit' })).toBeDefined();
  });

  it('sanitizes committed preload limits through the MindRoom policy module', async () => {
    const { MindroomMessagePreloadLimitInput } = await import(
      './MindroomMessagePreloadLimitSetting'
    );
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(React.createElement(MindroomMessagePreloadLimitInput));
    });
    const input = renderer!.root.findByType('input');

    act(() => {
      input.props.onChange({ target: { value: '12' } });
    });
    const updatedInput = renderer!.root.findByType('input');
    act(() => {
      updatedInput.props.onBlur();
    });

    expect(state.setPaginationLimit).toHaveBeenCalledWith(50);
  });

  it('commits valid limits from the Enter key', async () => {
    const { MindroomMessagePreloadLimitInput } = await import(
      './MindroomMessagePreloadLimitSetting'
    );
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(React.createElement(MindroomMessagePreloadLimitInput));
    });
    const input = renderer!.root.findByType('input');

    act(() => {
      input.props.onKeyDown({
        key: 'Enter',
        target: { value: '2500' },
      });
    });

    expect(state.setPaginationLimit).toHaveBeenCalledWith(2500);
  });
});
