import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { ConfigConfigError } from './ConfigConfig';

vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
  Button: ({
    children,
    onClick,
  }: {
    children?: React.ReactNode;
    onClick?: (event?: unknown) => void;
  }) => React.createElement('button', { onClick }, children),
  Dialog: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', null, children),
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

const renderConfigError = ({
  retry,
  ignore,
}: {
  retry: () => void;
  ignore: () => void;
}) => {
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(
      <ConfigConfigError error={new Error('config failed')} retry={retry} ignore={ignore} />
    );
  });
  return renderer!;
};

describe('ConfigConfigError', () => {
  it('does not forward the click event into the retry callback', () => {
    const retry = vi.fn();
    const ignore = vi.fn();
    const renderer = renderConfigError({ retry, ignore });

    const retryButton = getButtonByText(renderer, 'Retry');
    expect(retryButton).toBeDefined();

    act(() => {
      retryButton?.props.onClick({ type: 'click' });
    });

    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith();
  });

  it('does not forward the click event into the ignore callback', () => {
    const retry = vi.fn();
    const ignore = vi.fn();
    const renderer = renderConfigError({ retry, ignore });

    const continueButton = getButtonByText(renderer, 'Continue');
    expect(continueButton).toBeDefined();

    act(() => {
      continueButton?.props.onClick({ type: 'click' });
    });

    expect(ignore).toHaveBeenCalledTimes(1);
    expect(ignore).toHaveBeenCalledWith();
  });
});
