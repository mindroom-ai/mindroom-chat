import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { ConfigConfigError } from './ConfigConfig';

vi.mock('folds', () => ({
  Box: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children),
  Button: ({
    children,
    onClick,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: (event?: unknown) => void;
  }) => React.createElement('button', { ...props, onClick }, children),
  Dialog: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children),
  Text: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('span', props, children),
  color: {
    Critical: {
      Main: 'red',
    },
  },
  config: {
    space: {
      S400: '16px',
    },
  },
}));

vi.mock('../components/splash-screen', () => ({
  MindRoomSplashScreen: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
  SplashScreen: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

const getButtonByText = (renderer: ReactTestRenderer, text: string) =>
  renderer.root.findAllByType('button').find((button) =>
    button.findAllByType('span').some((span) => span.children.includes(text))
  );

describe('ConfigConfigError', () => {
  it('does not forward the click event into the retry callback', () => {
    const retry = vi.fn();
    const ignore = vi.fn();

    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ConfigConfigError error={new Error('config failed')} retry={retry} ignore={ignore} />
      );
    });

    const retryButton = getButtonByText(renderer!, 'Retry');
    expect(retryButton).toBeDefined();

    act(() => {
      retryButton?.props.onClick({ type: 'click' });
    });

    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith();
  });
});
