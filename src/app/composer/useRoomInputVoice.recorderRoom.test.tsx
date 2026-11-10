// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { expect, it, vi } from 'vitest';
import {
  pendingVoiceSendDraftAtom,
  type PendingVoiceSendDraft,
  voiceRecorderRoomAtom,
} from './roomInputDrafts';
import { useRoomInputVoice } from './useRoomInputVoice';

vi.mock('../matrix/hooks/useMediaConfig', () => ({ useMediaConfig: () => ({}) }));

const mx = {
  getUserId: () => '@alice:example.org',
  getRoom: () => ({ getMyMembership: () => 'join' }),
} as unknown as MatrixClient;
const draft = (roomId: string): PendingVoiceSendDraft => ({
  file: new File(['voice'], 'voice.ogg'),
  duration: 1000,
  context: {
    ownerSessionId: '@alice:example.org',
    roomId,
    room: { roomId, name: 'Room' } as Room,
    threadId: '$thread',
    replyDraft: undefined,
    threadingEnabled: true,
    signalBridgedRoom: false,
  },
});

const renderVoice = (store: ReturnType<typeof createStore>, roomId: string) =>
  renderHook(
    () =>
      useRoomInputVoice({
        mx,
        roomId,
        composer: {
          getContext: vi.fn(),
          snapshotText: vi.fn(),
          resetText: vi.fn(),
          restoreText: vi.fn(),
          clearConsumedReply: vi.fn(),
        } as never,
        attachments: { snapshot: () => ({ staged: [] }) } as never,
        transport: {} as never,
        sessions: { hasActiveSendSession: () => false, startSendSession: vi.fn() } as never,
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
      ),
    }
  );

it('names the room whose composer shows its recorder, until the recorder goes', () => {
  const store = createStore();
  const { unmount } = renderVoice(store, '!room:example.org');
  expect(store.get(voiceRecorderRoomAtom)).toBeUndefined();
  // A recording waiting to be sent from this room's composer shows its recorder.
  act(() => store.set(pendingVoiceSendDraftAtom, draft('!room:example.org')));
  expect(store.get(voiceRecorderRoomAtom)).toBe('!room:example.org');
  // Another room's recording names that room only in its own composer.
  act(() => store.set(pendingVoiceSendDraftAtom, draft('!other:example.org')));
  expect(store.get(voiceRecorderRoomAtom)).toBe('!room:example.org');
  unmount();
  expect(store.get(voiceRecorderRoomAtom)).toBeUndefined();
});
