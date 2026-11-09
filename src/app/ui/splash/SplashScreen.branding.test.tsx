import { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

/** This browser's copy of the last configuration it loaded (ClientConfigLoader's cache). */
const cacheConfig = (config: unknown) =>
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key.endsWith('/config.json') ? JSON.stringify(config) : null),
  });

describe('SplashScreen branding', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names no app before any configuration is known, as it may name another', () => {
    cacheConfig(null);
    const markup = renderToStaticMarkup(<SplashScreen />);
    expect(markup).not.toContain('data-name');
    expect(markup).not.toContain('MindRoom');
  });

  it('names the deployment of the last configuration this browser loaded until one loads', () => {
    cacheConfig({ branding: { title: 'Example Co' } });
    expect(renderToStaticMarkup(<SplashScreen />)).toContain(
      '<span data-name="true">Example Co</span>'
    );
    cacheConfig({});
    expect(renderToStaticMarkup(<SplashScreen />)).toContain(
      '<span data-name="true">MindRoom</span>'
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
