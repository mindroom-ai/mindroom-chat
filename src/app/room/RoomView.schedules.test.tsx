// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render } from '@testing-library/react';
import { createClient, Room } from 'matrix-js-sdk';
import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  conversationBehindPanelAtom,
  conversationCoveredAtom,
} from '../navigation/conversationCover';
import { RoomView } from './RoomView';
import type { RoomViewHeaderProps } from './RoomViewHeader';

const mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@alice:example.org' });
const room = new Room('!room:example.org', mx, '@alice:example.org');

const { capturedHeaderProps } = vi.hoisted(() => ({
  capturedHeaderProps: [] as RoomViewHeaderProps[],
}));

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../matrix/hooks/usePowerLevels', () => ({ usePowerLevelsContext: () => ({}) }));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ event: () => true }),
}));
vi.mock('../matrix/hooks/useStateEvent', () => ({ useStateEvent: () => undefined }));
vi.mock('../event-store/engine/engineContext', () => ({
  useSyncEngine: () => ({ noteRoomFocused: () => undefined, clearRoomFocus: () => undefined }),
}));
vi.mock('./useRoomViewThreadState', () => ({
  useRoomViewThreadState: () => ({
    viewMode: 'compact',
    handleExitThread: () => undefined,
    handleThreadRootDeleted: () => undefined,
    storeThreadSummary: () => undefined,
    summaryMap: new Map(),
    threadSortFreezeState: null,
  }),
}));
vi.mock('./RoomViewHeader', () => ({
  RoomViewHeader: (props: RoomViewHeaderProps) => {
    capturedHeaderProps.push(props);
    return null;
  },
}));
vi.mock('../timeline/RoomTimeline', () => ({ RoomTimeline: () => null }));
vi.mock('../timeline/typing/RoomViewTyping', () => ({ RoomViewTyping: () => null }));
vi.mock('../timeline/RoomViewFollowing', () => ({ RoomViewFollowing: () => null }));
vi.mock('../background-jobs/BackgroundJobsBar', () => ({ BackgroundJobsBar: () => null }));
vi.mock('../approvals/ThreadApprovalProvider', () => ({
  ThreadApprovalProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../composer/RoomInput', () => ({ RoomInput: () => null }));

afterEach(() => {
  cleanup();
  capturedHeaderProps.length = 0;
  getDefaultStore().set(conversationCoveredAtom, false);
  getDefaultStore().set(conversationBehindPanelAtom, false);
});

describe('RoomView schedule edit gating', () => {
  it('enables canEditSchedule when the room composer is visible and disables it under a plugin cover or side panel', () => {
    render(<RoomView room={room} />);
    expect(capturedHeaderProps.at(-1)?.canEditSchedule).toBe(true);

    cleanup();
    capturedHeaderProps.length = 0;
    getDefaultStore().set(conversationCoveredAtom, true);
    render(<RoomView room={room} />);
    expect(capturedHeaderProps.at(-1)?.canEditSchedule).toBe(false);

    cleanup();
    capturedHeaderProps.length = 0;
    getDefaultStore().set(conversationCoveredAtom, false);
    getDefaultStore().set(conversationBehindPanelAtom, true);
    render(<RoomView room={room} />);
    expect(capturedHeaderProps.at(-1)?.canEditSchedule).toBe(false);
  });
});
