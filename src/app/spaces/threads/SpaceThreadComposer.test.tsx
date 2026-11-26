// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { createRef, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { EventEmitter } from 'node:events';
import { Editor, Node as SlateNode, Transforms } from 'slate';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearRoomInputDrafts,
  composerReplyDraftAtom,
  forgetComposerStateOfSession,
  getRoomInputDraftKey,
  keepStagedFileNames,
  readKeptFileNames,
  roomIdToMsgDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
} from '../../composer/roomInputDrafts';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import { AutoDiscoveryInfoProvider } from '../../matrix/hooks/useAutoDiscoveryInfo';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { MediaConfigProvider } from '../../matrix/hooks/useMediaConfig';
import { SpaceThreadComposer } from './SpaceThreadComposer';
import type { SpaceRoomItem } from './spaceThreadsModel';

const harness = vi.hoisted(() => ({
  editor: undefined as Editor | undefined,
  onChange: undefined as (() => void) | undefined,
  pickFilesCallback: undefined as ((files: File[]) => void) | undefined,
  uploadContent: vi.fn(),
  sendMessage: vi.fn(),
  sendTyping: vi.fn(),
}));

vi.mock('focus-trap-react', () => ({
  FocusTrap: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('../../editor/Editor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../editor/Editor')>();
  return {
    ...actual,
    CustomEditor: ({
      editor,
      before,
      after,
      top,
      bottom,
      onChange,
    }: {
      editor: Editor;
      before?: ReactNode;
      after?: ReactNode;
      top?: ReactNode;
      bottom?: ReactNode;
      onChange?: () => void;
    }) => {
      harness.editor = editor;
      harness.onChange = onChange;
      return (
        <div>
          {top}
          <div data-testid="composer-text">
            {editor.children.map((node) => SlateNode.string(node)).join('\n')}
          </div>
          <div>{before}</div>
          <div>{after}</div>
          {bottom}
        </div>
      );
    },
  };
});

vi.mock('../../lib/hooks/useFilePicker', () => ({
  useFilePicker: (onSelect: (files: File[]) => void) => {
    harness.pickFilesCallback = onSelect;
    return () => undefined;
  },
}));

vi.mock('../../matrix/matrix', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../matrix/matrix')>();
  return {
    ...actual,
    encryptFile: async <T extends Blob>(file: T) => {
      const name = file instanceof File ? file.name : 'file';
      return {
        file: new File(['ciphertext'], name, { type: 'application/octet-stream' }),
        originalFile: file,
        encInfo: {
          v: 'v2',
          key: {
            kty: 'oct',
            key_ops: ['encrypt', 'decrypt'],
            alg: 'A256CTR',
            k: 'test-key',
            ext: true,
          },
          iv: 'test-iv',
          hashes: { sha256: 'test-hash' },
        },
      };
    },
  };
});

vi.mock('../../emoji/board/LazyEmojiBoard', () => ({ EmojiBoard: () => null }));
vi.mock('../../models/ModelPicker', () => ({ ThreadModelPicker: () => null }));
vi.mock('../../matrix/hooks/useRoomThreadMode', () => ({ useRoomThreadMode: () => 'thread' }));

const ME = '@me:example.org';
const SPACE_ID = '!space:example.org';
const ROOM_ENG = '!eng:example.org';
const ROOM_DES = '!des:example.org';

const makeRoom = (roomId: string, name: string, encrypted = false): Room => {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    roomId,
    name,
    myUserId: ME,
    getMyMembership: () => 'join',
    hasEncryptionStateEvent: () => encrypted,
    maySendMessage: () => true,
    getMember: () => ({ userId: ME, membership: 'join', name: 'Me', rawDisplayName: 'Me' }),
    getMembers: () => [],
    getJoinedMembers: () => [],
    getJoinedMemberCount: () => 2,
    membersLoaded: () => true,
    loadMembersIfNeeded: () => Promise.resolve(true),
    getMxcAvatarUrl: () => null,
    getCanonicalAlias: () => null,
    getEventForTxnId: () => undefined,
    currentState: {
      getStateEvents: (_type: string, stateKey?: string) => (stateKey === undefined ? [] : null),
      maySendEvent: () => true,
    },
  }) as unknown as Room;
};

const makeRoomItem = (room: Room, accentColor: string): SpaceRoomItem => ({
  room,
  name: room.name,
  accentColor,
});

const makeClient = (rooms: Room[]): MatrixClient => {
  const emitter = new EventEmitter();
  const byId = new Map(rooms.map((r) => [r.roomId, r]));
  let txn = 0;
  return Object.assign(emitter, {
    getUserId: () => ME,
    getSafeUserId: () => ME,
    getAccessToken: () => 'token',
    getHomeserverUrl: () => 'https://example.org',
    getRoom: (id: string) => byId.get(id) ?? null,
    getRooms: () => rooms,
    getAccountData: () => undefined,
    makeTxnId: () => `txn-${++txn}`,
    uploadContent: harness.uploadContent,
    cancelUpload: vi.fn(),
    sendMessage: harness.sendMessage,
    sendTyping: harness.sendTyping,
    cancelPendingEvent: vi.fn(),
    http: { getUrl: (p: string) => p, requestOtherUrl: vi.fn().mockResolvedValue(undefined) },
  }) as unknown as MatrixClient;
};

const typeIntoComposer = (text: string) => {
  const editor = harness.editor;
  if (!editor) throw new Error('Editor not mounted');
  act(() => {
    Transforms.insertText(editor, text, { at: Editor.end(editor, []) });
    harness.onChange?.();
  });
};

const stageFileInComposer = async (file: File) => {
  await act(async () => {
    harness.pickFilesCallback?.([file]);
    await Promise.resolve();
  });
};

const activeTargetOf = (container: HTMLElement) =>
  container
    .querySelector('[data-space-composer]')
    ?.getAttribute('data-space-composer-active-target');

describe('SpaceThreadComposer', () => {
  let store = createStore();

  afterEach(() => {
    cleanup();
    forgetComposerStateOfSession(store);
    clearRoomInputDrafts(ME);
    localStorage.clear();
    harness.editor = undefined;
    harness.onChange = undefined;
    harness.pickFilesCallback = undefined;
    harness.uploadContent.mockReset();
    harness.sendMessage.mockReset();
    harness.sendTyping.mockReset();
    store = createStore();
  });

  const renderComposer = (opts?: {
    screenSize?: ScreenSize;
    activeRoomIds?: readonly string[];
    onThreadCreated?: (roomId: string, eventId: string) => void;
  }) => {
    const eng = makeRoom(ROOM_ENG, 'Engineering', false);
    const des = makeRoom(ROOM_DES, 'Design', true);
    const rooms = [makeRoomItem(eng, '#3b82f6'), makeRoomItem(des, '#ec4899')];
    const roomsById = new Map(rooms.map((item) => [item.room.roomId, item]));
    const mx = makeClient([eng, des]);
    const dropRef = createRef<HTMLElement>();
    const onThreadCreated = opts?.onThreadCreated ?? vi.fn();
    const screenSize = opts?.screenSize ?? ScreenSize.Desktop;

    const buildTree = (activeRoomIds: readonly string[]) => (
      <MemoryRouter>
        <Provider store={store}>
          <MatrixClientProvider value={mx}>
            <ClientConfigProvider value={{}}>
              <AutoDiscoveryInfoProvider
                value={{ 'm.homeserver': { base_url: 'https://example.org' } }}
              >
                <MediaConfigProvider value={{ 'm.upload.size': 10_000_000 }}>
                  <ScreenSizeProvider value={screenSize}>
                    <SpaceThreadComposer
                      spaceId={SPACE_ID}
                      rooms={rooms}
                      roomsById={roomsById}
                      activeRoomIds={activeRoomIds}
                      fileDropContainerRef={dropRef}
                      onThreadCreated={onThreadCreated}
                    />
                  </ScreenSizeProvider>
                </MediaConfigProvider>
              </AutoDiscoveryInfoProvider>
            </ClientConfigProvider>
          </MatrixClientProvider>
        </Provider>
      </MemoryRouter>
    );

    const rendered = render(buildTree(opts?.activeRoomIds ?? [ROOM_ENG, ROOM_DES]));
    return {
      ...rendered,
      onThreadCreated,
      setActiveRoomIds: (next: readonly string[]) => rendered.rerender(buildTree(next)),
    };
  };

  it.each([
    { label: 'desktop pill', screenSize: ScreenSize.Desktop },
    { label: 'phone dropdown', screenSize: ScreenSize.Mobile },
  ])(
    'keeps typed text and deferred attachment across $label switch and prepares/encrypts for the new target on Send',
    async ({ screenSize }) => {
      harness.uploadContent.mockResolvedValue({ content_uri: 'mxc://example.org/enc-report' });
      harness.sendMessage
        .mockResolvedValueOnce({ event_id: '$upload-root' })
        .mockResolvedValueOnce({ event_id: '$caption-reply' });
      harness.sendTyping.mockResolvedValue({});

      const { container, onThreadCreated } = renderComposer({ screenSize });
      expect(activeTargetOf(container)).toBe(ROOM_ENG);

      typeIntoComposer('Release checklist');
      await stageFileInComposer(new File(['hello pdf'], 'report.pdf', { type: 'application/pdf' }));

      expect(screen.getByTestId('composer-text').textContent).toBe('Release checklist');
      expect(screen.getByText('report.pdf')).toBeTruthy();
      expect(harness.uploadContent).not.toHaveBeenCalled();

      // Switch target room from unencrypted Engineering to encrypted Design.
      if (screenSize === ScreenSize.Desktop) {
        fireEvent.click(container.querySelector(`[data-space-composer-target="${ROOM_DES}"]`)!);
      } else {
        fireEvent.click(
          container.querySelector<HTMLButtonElement>('[data-space-composer-picker="true"] button')!
        );
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Design' }));
      }

      expect(activeTargetOf(container)).toBe(ROOM_DES);
      expect(screen.getByTestId('composer-text').textContent).toBe('Release checklist');
      expect(screen.getByText('report.pdf')).toBeTruthy();
      expect(harness.uploadContent).not.toHaveBeenCalled();

      // Send: prepares & encrypts for Design, uploads once as ciphertext, sends both events to Design.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /send message/i }));
        await Promise.resolve();
      });

      expect(harness.uploadContent).toHaveBeenCalledTimes(1);
      expect(harness.uploadContent.mock.calls[0]?.[1]).toMatchObject({
        includeFilename: false,
        type: 'application/octet-stream',
      });
      expect(harness.sendMessage).toHaveBeenCalledTimes(2);
      expect(harness.sendMessage.mock.calls[0]?.[0]).toBe(ROOM_DES);
      expect(harness.sendMessage.mock.calls[0]?.[1]).toMatchObject({
        msgtype: 'm.file',
        body: 'report.pdf',
        file: expect.objectContaining({ url: 'mxc://example.org/enc-report' }),
      });
      expect(harness.sendMessage.mock.calls[1]?.[0]).toBe(ROOM_DES);
      expect(harness.sendMessage.mock.calls[1]?.[1]).toMatchObject({
        body: 'Release checklist',
      });
      expect(onThreadCreated).toHaveBeenCalledWith(ROOM_DES, '$upload-root');
      expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ENG))).toEqual([]);
      expect(store.get(roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(ME, ROOM_ENG)))).toEqual([]);
    }
  );

  it('stays isolated from target room drafts/replies/lost-files and re-encrypts on retry after switching targets', async () => {
    const engDraft = [{ type: 'paragraph', children: [{ text: 'Room-only draft' }] }] as never;
    store.set(roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(ME, ROOM_ENG)), engDraft);
    store.set(composerReplyDraftAtom(ROOM_ENG, undefined), {
      userId: '@peer:example.org',
      eventId: '$reply-target',
      body: 'Quoted room message',
    });
    const lostFile = new File(['old'], 'lost-in-room.png', { type: 'image/png' });
    keepStagedFileNames(ME, ROOM_ENG, [
      {
        file: lostFile,
        originalFile: lostFile,
        encInfo: undefined,
        metadata: { markedAsSpoiler: false },
      },
    ]);

    harness.sendTyping.mockResolvedValue({});
    const { container } = renderComposer();

    // Target room's own draft, reply, and lost-file warning do not appear in the Space composer.
    expect(screen.getByTestId('composer-text').textContent).toBe('');
    expect(screen.queryByText(/Quoted room message/)).toBeNull();
    expect(screen.queryByText(/lost-in-room\.png/)).toBeNull();

    // Stage a file + text in unencrypted Engineering and fail the first sendMessage.
    typeIntoComposer('Budget update');
    await stageFileInComposer(new File(['csv'], 'budget.csv', { type: 'text/csv' }));
    harness.uploadContent.mockResolvedValueOnce({ content_uri: 'mxc://example.org/plain-budget' });
    harness.sendMessage.mockRejectedValueOnce(new Error('room send failed'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send message/i }));
      await Promise.resolve();
    });

    expect(screen.getByTestId('composer-text').textContent).toBe('Budget update');
    expect(screen.getByText('budget.csv')).toBeTruthy();

    // Switch target to encrypted Design and retry: file is re-encrypted and uploaded as ciphertext.
    fireEvent.click(container.querySelector(`[data-space-composer-target="${ROOM_DES}"]`)!);
    harness.uploadContent.mockResolvedValueOnce({ content_uri: 'mxc://example.org/enc-budget' });
    harness.sendMessage
      .mockResolvedValueOnce({ event_id: '$des-file' })
      .mockResolvedValueOnce({ event_id: '$des-caption' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send message/i }));
      await Promise.resolve();
    });

    expect(harness.uploadContent).toHaveBeenCalledTimes(2);
    expect(harness.uploadContent.mock.calls[1]?.[1]).toMatchObject({
      includeFilename: false,
      type: 'application/octet-stream',
    });
    expect(harness.sendMessage.mock.calls[1]?.[0]).toBe(ROOM_DES);
    expect(harness.sendMessage.mock.calls[2]?.[0]).toBe(ROOM_DES);
    // Engineering's own room draft and kept lost-file names are untouched.
    expect(store.get(roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(ME, ROOM_ENG)))).toEqual(
      engDraft
    );
    expect(readKeptFileNames(ME, ROOM_ENG)).toEqual(['lost-in-room.png']);
  });

  it('pins the active target once a draft exists, resets stale non-draft choices on filter changes, and preserves slash commands', async () => {
    harness.sendTyping.mockResolvedValue({});
    const { container, setActiveRoomIds } = renderComposer();

    // Explicit pick while empty, then room filter narrows to Design: stale Engineering choice clears.
    fireEvent.click(container.querySelector(`[data-space-composer-target="${ROOM_ENG}"]`)!);
    setActiveRoomIds([ROOM_DES]);
    expect(activeTargetOf(container)).toBe(ROOM_DES);

    // Typing now pins Design instead of snapping back to the filtered-out Engineering room.
    typeIntoComposer('/notacommand');
    expect(activeTargetOf(container)).toBe(ROOM_DES);

    // Changing the filter to Engineering keeps Design pinned with the draft note.
    setActiveRoomIds([ROOM_ENG]);
    expect(activeTargetOf(container)).toBe(ROOM_DES);
    expect(
      container.querySelector(`[data-space-composer-draft-pinned="${ROOM_DES}"]`)
    ).toBeTruthy();

    // Explicit pick still switches to Engineering while preserving the draft text.
    fireEvent.click(container.querySelector(`[data-space-composer-target="${ROOM_ENG}"]`)!);
    expect(activeTargetOf(container)).toBe(ROOM_ENG);
    expect(screen.getByTestId('composer-text').textContent).toBe('/notacommand');

    // Unknown slash command stays blocked with an alert instead of sending raw text (unlike Home Ask).
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send message/i }));
      await Promise.resolve();
    });
    expect(harness.sendMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
