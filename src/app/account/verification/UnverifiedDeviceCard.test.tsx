// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsModalAtom } from '../../navigation/settingsModal';
import { SettingsPages } from '../../navigation/settingsPages';
import { recoveryDialogAtom } from '../encryption/recoveryDialog';
import { useRecoveryState, type RecoveryState } from '../encryption/recoveryState';
import { useOwnDeviceTrust } from './useOwnDeviceTrust';
import { UnverifiedDeviceCard } from './UnverifiedDeviceCard';

vi.mock('../encryption/recoveryState', () => ({ useRecoveryState: vi.fn() }));
vi.mock('./useOwnDeviceTrust', () => ({ useOwnDeviceTrust: vi.fn() }));

const KEY = { keyId: 'key1', keyContent: {}, hasPassphrase: true };

const renderCard = (state: RecoveryState) => {
  vi.mocked(useOwnDeviceTrust).mockReturnValue({
    crossSigning: true,
    thisDeviceVerified: false,
    otherUnverifiedDevices: 0,
  } as unknown as ReturnType<typeof useOwnDeviceTrust>);
  vi.mocked(useRecoveryState).mockReturnValue(state);
  const store = createStore();
  render(
    <Provider store={store}>
      <UnverifiedDeviceCard />
    </Provider>
  );
  return store;
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('UnverifiedDeviceCard', () => {
  it('opens the unlock dialog when the account has a recovery key to unlock with', async () => {
    const store = renderCard({ kind: 'locked', key: KEY });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unlock with recovery password' }));
    });
    expect(store.get(recoveryDialogAtom)).toBe('unlock');
    expect(store.get(settingsModalAtom)).toBeUndefined();
  });

  it('opens the security settings as before when there is nothing to unlock with', async () => {
    const store = renderCard({ kind: 'other' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    });
    expect(store.get(settingsModalAtom)).toEqual({ initialPage: SettingsPages.PrivacyPage });
    expect(store.get(recoveryDialogAtom)).toBeUndefined();
  });

  it('keeps its region name', () => {
    renderCard({ kind: 'locked', key: KEY });
    expect(screen.getByRole('region', { name: 'Unverified Device' })).toBeTruthy();
  });
});
