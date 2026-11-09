import 'fake-indexeddb/auto';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPENED_FROM_OUTSIDE_STATE } from '../../routes/historyStack';
import { NativeIOSPushOpenFeature } from './IOSPushFeature';

type ActionListener = (action: { notification: { data: unknown } }) => void;
type Account = { sessionId: string; lastKnownPath?: string };

const state = vi.hoisted(() => ({
  hasCompletedInitialSync: true,
  onAction: undefined as ActionListener | undefined,
  navigateRoom: vi.fn(),
  navigate: vi.fn(),
  activeSessionId: 'session-b',
  accounts: {
    'tag-a': { sessionId: 'session-a', lastKnownPath: '/home/!last-a:example' },
    'tag-b': { sessionId: 'session-b' },
  } as Record<string, Account>,
  setActiveSession: vi.fn(),
  mx: {
    getRoom: (roomId: string) => {
      if (roomId === '!joined:example') return { getMyMembership: () => 'join' };
      if (roomId === '!left:example') return { getMyMembership: () => 'leave' };
      return null;
    },
  },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: vi.fn(async (event: string, listener: ActionListener) => {
      if (event === 'pushNotificationActionPerformed') state.onAction = listener;
      return { remove: vi.fn(async () => undefined) };
    }),
  },
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }));
vi.mock('./iosPush', () => ({
  IOS_PUSH_ACCOUNT_KEY: 'mindroom_account',
  findIOSPushAccount: (tag: string) => state.accounts[tag],
  isNativeIOSPlatform: () => true,
}));
vi.mock('../../matrix/session/sessions', () => ({ setActiveSession: state.setActiveSession }));
vi.mock('../../matrix/session/useSessionStore', () => ({
  useActiveSession: () => ({ sessionId: state.activeSessionId }),
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => state.mx }));
vi.mock('../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: state.navigateRoom }),
}));
vi.mock('../../matrix/ClientStartupContext', () => ({
  useClientStartupContext: () => ({ hasCompletedInitialSync: state.hasCompletedInitialSync }),
}));

// A tapped push opens its message as a page opened from outside the app: its back buttons lead to
// its room and the room's list, not to the page the app was left on.
const outside = { state: OPENED_FROM_OUTSIDE_STATE };
const tap = (data: unknown) => act(async () => state.onAction?.({ notification: { data } }));
const mount = async (): Promise<ReactTestRenderer> => {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(React.createElement(NativeIOSPushOpenFeature));
  });
  if (!renderer) throw new Error('The feature did not render.');
  return renderer;
};

describe('NativeIOSPushOpenFeature', () => {
  afterEach(() => {
    state.hasCompletedInitialSync = true;
    state.onAction = undefined;
    state.activeSessionId = 'session-b';
    vi.clearAllMocks();
  });

  it('opens the event of a tapped push, once the first sync is done', async () => {
    state.hasCompletedInitialSync = false;
    const renderer = await mount();
    await tap({ aps: {}, room_id: '!joined:example', event_id: '$reply' });
    expect(state.navigateRoom).not.toHaveBeenCalled();

    state.hasCompletedInitialSync = true;
    await act(async () => renderer.update(React.createElement(NativeIOSPushOpenFeature)));

    expect(state.navigateRoom).toHaveBeenCalledTimes(1);
    expect(state.navigateRoom).toHaveBeenCalledWith('!joined:example', '$reply', outside);
    renderer.unmount();
  });

  it('leaves an untagged push of a room this account is not in, a left room and a push without a room alone', async () => {
    const renderer = await mount();
    await tap({ aps: {}, room_id: '!elsewhere:example', event_id: '$event' });
    await tap({ aps: {}, room_id: '!left:example', event_id: '$event' });
    await tap({ aps: {} });
    await tap({ aps: {}, room_id: '!elsewhere:example', mindroom_account: 'signed-out' });

    expect(state.navigateRoom).not.toHaveBeenCalled();
    expect(state.setActiveSession).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it("opens the active account's own tagged push without switching", async () => {
    const renderer = await mount();
    await tap({ aps: {}, room_id: '!joined:example', event_id: '$own', mindroom_account: 'tag-b' });

    expect(state.setActiveSession).not.toHaveBeenCalled();
    expect(state.navigateRoom).toHaveBeenCalledWith('!joined:example', '$own', outside);
    renderer.unmount();
  });

  it("switches to the account a push belongs to and opens it there after that account's first sync", async () => {
    state.setActiveSession.mockImplementation((sessionId: string) => ({ sessionId }));
    const accountB = await mount();
    await tap({
      aps: {},
      room_id: '!joined:example',
      event_id: '$for-a',
      mindroom_account: 'tag-a',
    });

    expect(state.setActiveSession).toHaveBeenCalledWith('session-a');
    expect(state.navigate).toHaveBeenCalledWith('/home/!last-a:example');
    expect(state.navigateRoom).not.toHaveBeenCalled();

    // The switch remounts the signed-in pages for account A, whose first sync is not done yet.
    accountB.unmount();
    state.activeSessionId = 'session-a';
    state.hasCompletedInitialSync = false;
    const accountA = await mount();
    expect(state.navigateRoom).not.toHaveBeenCalled();

    state.hasCompletedInitialSync = true;
    await act(async () => accountA.update(React.createElement(NativeIOSPushOpenFeature)));

    expect(state.navigateRoom).toHaveBeenCalledTimes(1);
    expect(state.navigateRoom).toHaveBeenCalledWith('!joined:example', '$for-a', outside);
    accountA.unmount();

    // The push opens once: mounting account A again opens nothing.
    const again = await mount();
    expect(state.navigateRoom).toHaveBeenCalledTimes(1);
    again.unmount();
  });

  it('opens the push in the current account when the switch cannot be saved', async () => {
    state.setActiveSession.mockImplementation(() => {
      throw new Error('quota');
    });
    const renderer = await mount();
    await tap({ aps: {}, room_id: '!joined:example', mindroom_account: 'tag-a' });

    expect(state.setActiveSession).toHaveBeenCalledWith('session-a');
    expect(state.navigate).not.toHaveBeenCalled();
    expect(state.navigateRoom).toHaveBeenCalledWith('!joined:example', undefined, outside);
    renderer.unmount();
  });
});
