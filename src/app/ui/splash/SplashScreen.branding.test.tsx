import { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { SplashScreen } from './SplashScreen';

vi.mock('folds', () => ({
  Box: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <span data-name>{children}</span>,
}));
vi.mock('./SplashScreen.css', () => ({
  SplashScreen: 'splash-screen',
  SplashScreenContent: 'splash-screen-content',
  SplashScreenFooter: 'splash-screen-footer',
  SplashScreenParticle: 'splash-screen-particle',
  SplashScreenPersistentParticle: 'splash-screen-persistent-particle',
}));
vi.mock('../particle-background/PersistentParticleBackground', () => ({
  ParticleBackgroundSurface: () => null,
  usePersistentParticleBackground: () => false,
}));

describe('SplashScreen branding', () => {
  it('names the app MindRoom Chat before the configuration is known', () => {
    expect(renderToStaticMarkup(<SplashScreen />)).toContain(
      '<span data-name="true">MindRoom Chat</span>'
    );
  });

  it("names the deployment's brand once the configuration sets one", () => {
    expect(
      renderToStaticMarkup(
        <ClientConfigProvider value={{ branding: { title: 'Example Co' } }}>
          <SplashScreen />
        </ClientConfigProvider>
      )
    ).toContain('<span data-name="true">Example Co</span>');
  });
});
