// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Provider, createStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncomingRing } from './callRings';
import { callPanelRoomAtom, callStartProblemAtom, type StartCallResult } from './callStore';
import { IncomingCalls } from './IncomingCalls';

const ROOM_ID = '!direct:calls.test';

const calls = vi.hoisted(() => ({
  ring: undefined as ((ring: IncomingRing) => void) | undefined,
  /** What Answer's start resolves with; a test answers it after switching accounts. */
  answer: undefined as ((result: StartCallResult) => void) | undefined,
}));
const client = vi.hoisted(() => ({
  clientRunning: true,
  getRoom: (roomId: string) => ({ roomId }),
  getSafeUserId: () => '@me:calls.test',
  matrixRTC: { getRoomSession: () => ({}) },
}));

vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: vi.fn() }),
}));
vi.mock('../../hooks/useRoomMeta', () => ({ useRoomName: () => 'Maya' }));
vi.mock('../../state/hooks/settings', () => ({ useSetting: () => [false] }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./callRings', () => ({
  watchRings: (_mx: unknown, { onRing }: { onRing: (ring: IncomingRing) => void }) => {
    calls.ring = onRing;
    return () => undefined;
  },
  declineRing: vi.fn(async () => undefined),
}));
vi.mock('./callMemberships', () => ({ activeMemberships: () => [{ userId: '@maya:calls.test' }] }));
vi.mock('./CallTile', () => ({
  CallMemberAvatar: () => null,
  useCallMemberProfile: () => ({ name: 'Maya' }),
}));
vi.mock('./callStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./callStore')>()),
  useActiveCall: () => undefined,
  useCallActions: () => ({
    startCall: () =>
      new Promise<StartCallResult>((resolve) => {
        calls.answer = resolve;
      }),
  }),
}));
vi.mock('./IncomingCalls.css', () => ({ Card: 'card' }));
vi.mock('../../components/glass/GlassPrimitives', () => ({
  Surface: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement('section', props, children),
}));
vi.mock('folds', () => {
  const plain =
    (tag: string) =>
    ({
      children,
      before: _before,
      ...props
    }: Record<string, unknown> & { children?: React.ReactNode }) =>
      React.createElement(tag, props, children);
  return {
    Box: plain('div'),
    Button: plain('button'),
    Text: plain('span'),
    Icon: () => null,
    Icons: { Phone: 'Phone', PhoneDown: 'PhoneDown' },
  };
});

/** Shows a ring from Maya and presses Answer. */
const answerRing = (store: ReturnType<typeof createStore>): ReactTestRenderer => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(
      <Provider store={store}>
        <IncomingCalls />
      </Provider>
    );
  });
  act(() => {
    calls.ring?.({
      roomId: ROOM_ID,
      eventId: '$ring',
      sender: '@maya:calls.test',
      video: false,
      expiresAt: Date.now() + 30_000,
    });
  });
  const shown = renderer as ReactTestRenderer;
  const [label] = shown.root.findAllByProps({ children: 'sharedUi.callEmbedProvider.answer' });
  let answer = label;
  while (answer && answer.type !== 'button') answer = answer.parent ?? undefined;
  act(() => {
    answer?.props.onClick();
  });
  return shown;
};

afterEach(() => {
  client.clientRunning = true;
  calls.ring = undefined;
  calls.answer = undefined;
});

describe('IncomingCalls Answer', () => {
  it("opens the room's call panel with why the call did not start", async () => {
    const store = createStore();
    const renderer = answerRing(store);
    await act(async () => {
      calls.answer?.('busy');
      await Promise.resolve();
    });

    expect(store.get(callStartProblemAtom)).toEqual({ roomId: ROOM_ID, result: 'busy' });
    expect(store.get(callPanelRoomAtom)).toBe(ROOM_ID);
    act(() => renderer.unmount());
  });

  it('leaves the next account nothing when the account that answered went away meanwhile', async () => {
    const store = createStore();
    const renderer = answerRing(store);
    // The account switches while the call starts: its client stops and the start fails.
    act(() => renderer.unmount());
    client.clientRunning = false;
    await act(async () => {
      calls.answer?.('failed');
      await Promise.resolve();
    });

    expect(store.get(callStartProblemAtom)).toBeUndefined();
    expect(store.get(callPanelRoomAtom)).toBeUndefined();
  });
});
