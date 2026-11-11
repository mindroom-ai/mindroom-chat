// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveSession, listSessions, putSession } from '../../matrix/session/sessions';
import { createMatrixClient } from '../../matrix/client/matrixClientFactory';
import { useCompleteSession, type SessionCredentials } from './completeSession';

const logout = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('../../matrix/client/matrixClientFactory', () => ({
  createMatrixClient: vi.fn(() => ({ logout })),
}));

const BASE_URL = 'https://example.org';
const ALICE = '@alice:example.org';

function Completion({ response }: { response: SessionCredentials }) {
  useCompleteSession({ baseUrl: BASE_URL, response });
  return <span>login page</span>;
}

let renderer: ReactTestRenderer | undefined;
const complete = async (response: SessionCredentials) => {
  await act(async () => {
    renderer = create(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Completion response={response} />} />
          <Route path="/home" element={<span>home page</span>} />
        </Routes>
      </MemoryRouter>
    );
  });
};

beforeEach(() => {
  localStorage.clear();
  logout.mockClear();
  vi.mocked(createMatrixClient).mockClear();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  window.history.replaceState(null, '', '/');
});

describe('useCompleteSession for an account this browser has already', () => {
  it('keeps the stored device and signs the new one out again', async () => {
    putSession({ baseUrl: BASE_URL, userId: ALICE, deviceId: 'LAPTOP', accessToken: 'old' });
    putSession({
      baseUrl: 'https://other.example',
      userId: '@bob:other.example',
      deviceId: 'BOB',
      accessToken: 'bob',
    });

    // Bob is signed in, so Alice signs in again through Add account.
    window.history.replaceState(null, '', '/login?addAccount=1');
    await complete({ user_id: ALICE, device_id: 'NEW', access_token: 'new' });

    const alice = listSessions().filter((session) => session.userId === ALICE);
    expect(alice).toHaveLength(1);
    expect(alice[0]).toMatchObject({ deviceId: 'LAPTOP', accessToken: 'old' });
    expect(getActiveSession()?.userId).toBe(ALICE);
    expect(createMatrixClient).toHaveBeenCalledWith({
      baseUrl: BASE_URL,
      userId: ALICE,
      deviceId: 'NEW',
      accessToken: 'new',
    });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(renderer?.root.findByType('span').children).toEqual(['home page']);
  });

  it('takes new tokens for the same device, and stores a new account, without signing out', async () => {
    putSession({ baseUrl: BASE_URL, userId: ALICE, deviceId: 'LAPTOP', accessToken: 'old' });
    await complete({ user_id: ALICE, device_id: 'LAPTOP', access_token: 'rotated' });
    expect(listSessions()[0]).toMatchObject({ deviceId: 'LAPTOP', accessToken: 'rotated' });
    act(() => renderer?.unmount());

    await complete({ user_id: '@carol:example.org', device_id: 'PHONE', access_token: 'carol' });
    expect(getActiveSession()).toMatchObject({ userId: '@carol:example.org', deviceId: 'PHONE' });
    expect(logout).not.toHaveBeenCalled();
  });
});
