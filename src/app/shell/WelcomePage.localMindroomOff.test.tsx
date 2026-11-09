// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ClientConfig, useClientConfig } from '../config/useClientConfig';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { getLocalMindroomConnections } from '../local-mindroom/api';
import { getWelcomeSetupFirstSeenStorageKey } from '../preferences/accountStorageKeys';
import { WelcomePage } from './WelcomePage';

vi.mock('../config/useClientConfig', () => ({ useClientConfig: vi.fn() }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: vi.fn() }));
vi.mock('../local-mindroom/api', () => ({ getLocalMindroomConnections: vi.fn() }));
// The page frame's styles need the build's CSS plugin, and the cards beside the setup steps read
// crypto state this test has no part in.
vi.mock('../ui/page/Page', () => {
  const Frame = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { Page: Frame, PageHero: Frame, PageHeroSection: Frame };
});
vi.mock('../account/verification/UnverifiedDeviceCard', () => ({
  UnverifiedDeviceCard: () => null,
}));
vi.mock('../account/onboarding/KeyBackupNudge', () => ({ KeyBackupNudge: () => null }));

const USER_ID = '@ada:mindroom.chat';
const FIRST_SEEN_KEY = getWelcomeSetupFirstSeenStorageKey(USER_ID);
const SETUP_HEADING = 'Set up Local MindRoom';

/** An account on mindroom.chat, which its provisioning service accepts. */
const account = {
  getSafeUserId: () => USER_ID,
  getHomeserverUrl: () => 'https://mindroom.chat',
  getAccessToken: () => 'access-token',
  getCrypto: () => undefined,
  getOpenIdToken: async () => ({ access_token: 'openid-token' }),
};

/** Shows the welcome page two days after its first visit, with nothing paired yet. */
const showWelcomeLater = async (sidebar: ClientConfig['sidebar']): Promise<void> => {
  localStorage.setItem(FIRST_SEEN_KEY, String(Date.now() - 2 * 24 * 60 * 60 * 1000));
  vi.mocked(useClientConfig).mockReturnValue({ sidebar, welcome: {} });
  render(<WelcomePage />);
  await act(async () => undefined);
};

beforeEach(() => {
  vi.mocked(useMatrixClient).mockReturnValue(
    account as unknown as ReturnType<typeof useMatrixClient>
  );
  vi.mocked(getLocalMindroomConnections).mockResolvedValue({ connections: [] });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.mocked(getLocalMindroomConnections).mockReset();
});

describe('WelcomePage when the deployment turns Local MindRoom off', () => {
  it('shows the setup steps while Local MindRoom is on', async () => {
    await showWelcomeLater(undefined);
    expect(await screen.findByText(SETUP_HEADING)).toBeTruthy();
  });

  it('shows no setup steps and asks provisioning nothing with showMindRoom false', async () => {
    await showWelcomeLater({ showMindRoom: false });
    expect(screen.queryByText(SETUP_HEADING)).toBeNull();
    expect(getLocalMindroomConnections).not.toHaveBeenCalled();
  });
});
