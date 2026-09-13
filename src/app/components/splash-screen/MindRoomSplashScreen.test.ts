import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MINDROOM_SPLASH_MESSAGES,
  MindRoomSplashScreen,
  pickMindRoomSplashMessage,
} from './MindRoomSplashScreen';

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Box: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Spinner: () => reactModule.createElement('div', null, 'spinner'),
    Text: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
  };
});

vi.mock('../particle-background', () => ({
  MindRoomParticleBackground: () => React.createElement('div', null, 'particle background'),
}));

vi.mock('./SplashScreen', () => ({
  SplashScreen: ({
    children,
    background,
  }: {
    children?: React.ReactNode;
    background?: React.ReactNode;
  }) => React.createElement('div', { 'data-has-background': Boolean(background) }, children),
}));

describe('MindRoomSplashScreen', () => {
  it('chooses a configured loading message from the deployment list', () => {
    const message = pickMindRoomSplashMessage(['One', 'Two', 'Three'], () => 0.7);

    expect(message).toBe('Three');
  });

  it('falls back to the default loading message when deployment messages are empty', () => {
    const message = pickMindRoomSplashMessage(['', '  '], () => 0.7);

    expect(message).toBe(DEFAULT_MINDROOM_SPLASH_MESSAGES[0]);
  });

  it('renders the selected loading message with the shared particle background', () => {
    const renderer = create(
      React.createElement(MindRoomSplashScreen, {
        loadingMessages: ['Alpha', 'Beta'],
        random: () => 0.1,
      })
    );

    expect(renderer.root.findByProps({ 'data-has-background': true })).toBeDefined();
    expect(
      renderer.root.findAll(
        (node) => typeof node.type === 'string' && node.children.includes('Alpha')
      )
    ).toHaveLength(1);
  });
});
