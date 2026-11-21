import 'fake-indexeddb/auto';
import { createStore, Provider } from 'jotai';
import { KnownMembership, type MatrixClient, type Room } from 'matrix-js-sdk';
import { openDB } from 'idb';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveVoiceRecordingAtom, pendingVoiceSendDraftAtom } from '../composer/roomInputDrafts';
import { clearSavedVoiceDraft, readSavedVoiceDraft } from '../composer/voice/savedVoiceDraft';
import {
  beginVoiceRecording,
  clearVoiceRecordings,
  hasVoiceRecordings,
  releaseVoiceRecording,
} from '../composer/voice/voiceRecordingJournal';
import { LogoutDialog } from './LogoutDialog';

const USER = '@harbor:example.org';
const ROOM = '!desk:example.org';
const DRAFT_ROOM = '!field:example.org';
const threadId = '$report';
const room = {
  roomId: ROOM,
  getMyMembership: () => KnownMembership.Join,
  isSpaceRoom: () => false,
  getMembers: () => [],
} as Room;
const draftRoom = { ...room, roomId: DRAFT_ROOM } as Room;
const { logout, navigateRoom, navigateRoomThread, navigatePath } = vi.hoisted(() => ({
  logout: vi.fn(async () => undefined),
  navigateRoom: vi.fn(),
  navigateRoomThread: vi.fn(),
  navigatePath: vi.fn(),
}));
const client = {
  getUserId: () => USER,
  getCrypto: () => undefined,
  getRoom: (id: string) => [room, draftRoom].find((item) => item.roomId === id) ?? null,
  getRooms: () => [room, draftRoom],
} as unknown as MatrixClient;
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../navigation/useSelectedRoom', () => ({ useSelectedRoom: () => ROOM }));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom, navigateRoomThread, navigatePath }),
}));
vi.mock('./lifecycle/sessionLifecycle', () => ({ logoutClient: logout }));
vi.mock('./lifecycle/initMatrix', () => ({ logoutStoredSession: logout }));
vi.mock('folds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('folds')>()),
  Box: 'div',
  Text: 'span',
  Button: 'button',
  Icon: 'i',
  Spinner: 'span',
}));
vi.mock('../ui/glass/GlassPrimitives', () => ({
  Dialog: 'div',
  Header: 'header',
  IconButton: 'button',
}));
vi.mock('../ui/styles/ContainerColor.css', () => ({ ContainerColor: () => '' }));

const context = {
  ownerSessionId: USER,
  roomId: ROOM,
  room,
  threadId: undefined,
  replyDraft: undefined,
  threadingEnabled: true,
  signalBridgedRoom: false,
};
const storeDraft = async () => {
  const db = await openDB('mindroom-voice-drafts', 1, {
    upgrade(db) {
      db.createObjectStore('drafts', { keyPath: 'userId' });
    },
  });
  try {
    await db.put('drafts', {
      userId: USER,
      roomId: DRAFT_ROOM,
      threadId,
      audio: await new Blob(['failed audio']).arrayBuffer(),
      fileName: 'field.ogg',
      fileType: 'audio/ogg',
      duration: 2_000,
      threadingEnabled: true,
      signalBridgedRoom: false,
    });
  } finally {
    db.close();
  }
};
const storeJournal = async () => {
  const recording = beginVoiceRecording(USER, Date.now(), 'audio/ogg')!;
  await recording.append(0, new Blob(['journal audio']), 1_000);
  releaseVoiceRecording(recording.id);
};

let renderer: ReactTestRenderer | undefined;
const mount = async (store = createStore()) => {
  const handleClose = vi.fn();
  const onShowRecording = vi.fn();
  await act(async () => {
    renderer = create(
      <Provider store={store}>
        <LogoutDialog handleClose={handleClose} onShowRecording={onShowRecording} />
      </Provider>
    );
  });
  const button = (text: string) =>
    renderer!.root
      .findAllByType('button')
      .find((entry) => entry.findAllByType('span').some((span) => span.children.includes(text)));
  const press = async (text: string) => {
    const control = button(text);
    expect(control?.props.disabled).toBe(false);
    await act(async () => {
      (control?.props.onClick as () => void)();
    });
  };
  return { handleClose, onShowRecording, press, button };
};

beforeEach(() => {
  vi.stubGlobal('navigator', {
    locks: {
      request: async (name: string, _opts: LockOptions, callback: LockGrantedCallback) =>
        callback({ name, mode: 'exclusive' }),
    },
  });
  vi.clearAllMocks();
});
afterEach(async () => {
  act(() => renderer?.unmount());
  renderer = undefined;
  await Promise.all([clearSavedVoiceDraft(USER), clearVoiceRecordings(USER)]);
  vi.unstubAllGlobals();
});

describe('voice before interactive logout', () => {
  it('keeps ordinary logout when there is no recording', async () => {
    const { button, press } = await mount();
    await vi.waitFor(() => expect(button('Logout')?.props.disabled).toBe(false));
    expect(button('Discard and sign out')).toBeUndefined();
    await press('Logout');
    await vi.waitFor(() => expect(logout).toHaveBeenCalledExactlyOnceWith(client));
  });

  it.each(['live', 'journal', 'failed send'])(
    'warns about %s and Send it leaves audio available',
    async (source) => {
      const store = createStore();
      const discard = vi.fn(async () => undefined);
      if (source === 'live') store.set(liveVoiceRecordingAtom, { context, discard });
      else if (source === 'journal') await storeJournal();
      else await storeDraft();
      const { handleClose, onShowRecording, button, press } = await mount(store);
      await vi.waitFor(() => expect(button('Send it')?.props.disabled).toBe(false));
      await press('Send it');
      await vi.waitFor(() => expect(onShowRecording).toHaveBeenCalledOnce());
      expect(handleClose).toHaveBeenCalledOnce();
      expect(logout).not.toHaveBeenCalled();
      expect(discard).not.toHaveBeenCalled();
      if (source === 'journal') {
        expect(await hasVoiceRecordings(USER)).toBe(true);
        expect(store.get(pendingVoiceSendDraftAtom)?.recovered).toBe(true);
      } else if (source === 'failed send') {
        expect(await readSavedVoiceDraft(USER)).toBeDefined();
        expect(navigateRoomThread).toHaveBeenCalledExactlyOnceWith(DRAFT_ROOM, threadId);
      } else expect(navigateRoom).not.toHaveBeenCalled();
    }
  );

  it.each(['Cancel', 'Discard and sign out'])(
    '%s settles before the account leaves',
    async (choice) => {
      const store = createStore();
      const discard = vi.fn(async () => undefined);
      store.set(liveVoiceRecordingAtom, { context, discard });
      await storeJournal();
      await storeDraft();
      const { button, handleClose, press } = await mount(store);
      await vi.waitFor(() => expect(button(choice)?.props.disabled).toBe(false));
      const deletedBeforeLogout = vi.fn();
      if (choice === 'Discard and sign out') {
        logout.mockImplementationOnce(async () => {
          deletedBeforeLogout(
            discard.mock.calls.length,
            await hasVoiceRecordings(USER),
            await readSavedVoiceDraft(USER)
          );
        });
      }
      await press(choice);
      if (choice === 'Cancel') {
        expect(handleClose).toHaveBeenCalledOnce();
        expect(discard).not.toHaveBeenCalled();
        expect(logout).not.toHaveBeenCalled();
        expect(await hasVoiceRecordings(USER)).toBe(true);
        expect(await readSavedVoiceDraft(USER)).toBeDefined();
      } else {
        await vi.waitFor(() =>
          expect(deletedBeforeLogout).toHaveBeenCalledExactlyOnceWith(1, false, undefined)
        );
        expect(logout).toHaveBeenCalledExactlyOnceWith(client);
      }
    }
  );
});
