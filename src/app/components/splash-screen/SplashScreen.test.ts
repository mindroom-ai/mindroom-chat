import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { SplashScreen } from './SplashScreen';

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Box: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
      reactModule.createElement('div', { className }, children),
    Text: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
  };
});

vi.mock('../particle-background', () => ({
  MindRoomParticleBackground: ({ position }: { position?: string }) =>
    React.createElement('div', {
      'data-mindroom-particle-background': true,
      'data-position': position,
    }),
}));

vi.mock('./SplashScreen.css', () => ({
  SplashScreen: 'splash-screen',
  SplashScreenContent: 'splash-screen-content',
  SplashScreenFooter: 'splash-screen-footer',
  SplashScreenParticle: 'splash-screen-particle',
}));

describe('SplashScreen', () => {
  it('uses the MindRoom particle background by default', () => {
    const renderer = create(
      React.createElement(SplashScreen, null, React.createElement('span', null, 'Content'))
    );

    expect(
      renderer.root.findByProps({
        'data-mindroom-particle-background': true,
        'data-position': 'fixed',
      })
    ).toBeDefined();
  });

  it('renders a custom background instead of the particle background', () => {
    const customBackground = React.createElement('div', {
      'data-custom-background': true,
    });

    const renderer = create(
      React.createElement(
        SplashScreen,
        { background: customBackground },
        React.createElement('span', null, 'Content')
      )
    );

    expect(renderer.root.findByProps({ 'data-custom-background': true })).toBeDefined();
    expect(
      renderer.root.findAllByProps({ 'data-mindroom-particle-background': true })
    ).toHaveLength(0);
  });

  it.each([null, false])(
    'falls back to the MindRoom particle background when background is %s',
    (background) => {
      const renderer = create(
        React.createElement(
          SplashScreen,
          { background },
          React.createElement('span', null, 'Content')
        )
      );

      expect(
        renderer.root.findByProps({
          'data-mindroom-particle-background': true,
          'data-position': 'fixed',
        })
      ).toBeDefined();
      expect(
        renderer.root.findAll(
          (node) => node.type === 'div' && node.props.className === 'splash-screen-content'
        )
      ).toHaveLength(1);
    }
  );
});
