// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ClientConfig, useClientConfig } from '../config/useClientConfig';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { tourAtom } from '../navigation/tourState';
import { WelcomePage } from './WelcomePage';

vi.mock('../config/useClientConfig', () => ({ useClientConfig: vi.fn() }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: vi.fn() }));
// The page frame's styles need the build's CSS plugin, and the cards read crypto state this test
// has no part in; each leaves a mark where it stands in the column.
vi.mock('../ui/page/Page', () => {
  const Frame = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { Page: Frame, PageHero: Frame, PageHeroSection: Frame };
});
vi.mock('../account/verification/UnverifiedDeviceCard', () => ({
  UnverifiedDeviceCard: () => <div data-testid="device-card" />,
}));
vi.mock('../account/onboarding/KeyBackupNudge', () => ({
  KeyBackupNudge: () => <div data-testid="backup-card" />,
}));

const TOUR_LINK = 'How threads work';

const account = {
  getSafeUserId: () => '@ada:mindroom.chat',
  getHomeserverUrl: () => 'https://mindroom.chat',
  getAccessToken: () => 'access-token',
};

/** The welcome page of a deployment with this `welcome` config, and the store its links write to. */
const showWelcome = (welcome: ClientConfig['welcome']) => {
  // Without Local MindRoom the page asks provisioning nothing.
  vi.mocked(useClientConfig).mockReturnValue({ sidebar: { showMindRoom: false }, welcome });
  const store = createStore();
  render(
    <Provider store={store}>
      <WelcomePage />
    </Provider>
  );
  return store;
};

/** Whether `later` comes after `earlier` in the page. */
const follows = (earlier: Element, later: Element): boolean =>
  (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

beforeEach(() => {
  vi.mocked(useMatrixClient).mockReturnValue(
    account as unknown as ReturnType<typeof useMatrixClient>
  );
});

afterEach(cleanup);

describe('WelcomePage tour link', () => {
  it('shows a button after the docs link and before the device and backup cards', () => {
    showWelcome({ docsUrl: 'https://docs.example.test', docsLabel: 'Docs' });

    const tour = screen.getByRole('button', { name: TOUR_LINK });
    expect(tour.tagName).toBe('BUTTON');
    expect(tour.getAttribute('type')).toBe('button');
    expect(tour.hasAttribute('href')).toBe(false);
    expect(tour.hasAttribute('target')).toBe(false);

    // The links beside it still open in a new tab.
    const docs = screen.getByRole('link', { name: 'Docs' });
    expect(docs.getAttribute('href')).toBe('https://docs.example.test');
    expect(docs.getAttribute('target')).toBe('_blank');

    expect(follows(docs, tour)).toBe(true);
    expect(follows(tour, screen.getByTestId('device-card'))).toBe(true);
    expect(follows(tour, screen.getByTestId('backup-card'))).toBe(true);
  });

  it('opens the Quick tour', () => {
    const store = showWelcome({});
    expect(store.get(tourAtom)).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: TOUR_LINK }));

    expect(store.get(tourAtom)).toEqual({ level: 'quick' });
  });

  it('shows on a deployment that links neither docs nor source and credits nobody', () => {
    showWelcome({ docsUrl: '', sourceUrl: '', poweredBy: [] });

    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(screen.getByRole('button', { name: TOUR_LINK })).toBeTruthy();
  });
});
