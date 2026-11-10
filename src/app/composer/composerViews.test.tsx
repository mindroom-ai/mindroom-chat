// @vitest-environment jsdom
import React, { createRef, type ReactNode } from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createEditor } from 'slate';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import {
  readKeptFileNames,
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
} from './roomInputDrafts';
import type { TUploadItem } from '../matrix/state/upload';
import { ConversationViewContext, composerStateKey } from '../navigation/conversationView';
import { useRoomInputAttachments } from './useRoomInputAttachments';
import { useRoomInputUploadTransport } from './useRoomInputUploadTransport';

// Two composers of one room: the room page's and another conversation view's (a plugin's thread
// view), each with its own staged files.
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./upload/UploadCardRenderer', () => ({ UploadCardRenderer: () => null }));
vi.mock('./upload/UploadBoard', () => ({
  UploadBoard: () => null,
  UploadBoardContent: () => null,
  UploadBoardHeader: () => null,
}));
vi.mock('./RoomInputExtensions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./RoomInputExtensions')>()),
  getRoomInputVoiceUploadRelation: () => undefined,
}));

const ME = '@tester:example.org';
const ROOM_ID = '!views:example.org';
const VIEW = 'thread-view';
const room = { roomId: ROOM_ID, name: 'Views', hasEncryptionStateEvent: () => false } as Room;
const fileItem = (name: string): TUploadItem => {
  const file = new File(['content'], name, { type: 'text/plain' });
  return { file, originalFile: file, encInfo: undefined, metadata: { markedAsSpoiler: false } };
};

type Composer = {
  attachments: ReturnType<typeof useRoomInputAttachments>;
  transport: ReturnType<typeof useRoomInputUploadTransport>;
};

let renderer: ReactTestRenderer | undefined;
beforeEach(() => localStorage.clear());
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

const renderTwoComposers = () => {
  const store = createStore();
  const mx = { cancelUpload: vi.fn() };
  const composers = {} as Record<'page' | 'view', Composer>;
  const Composer = ({ name }: { name: 'page' | 'view' }) => {
    composers[name] = {
      attachments: useRoomInputAttachments({
        mx: mx as never,
        userId: ME,
        room,
        roomId: ROOM_ID,
        draftKey: undefined,
        editor: React.useMemo(() => {
          const editor = createEditor();
          editor.children = [{ type: 'paragraph', children: [{ text: '' }] }];
          return editor;
        }, []),
        isMarkdown: true,
        fileDropContainerRef: createRef<HTMLElement>(),
        createUploadItems: async () => [],
      }),
      transport: useRoomInputUploadTransport(mx as never, store, room),
    };
    return null;
  };
  const inStore = (children: ReactNode) => <Provider store={store}>{children}</Provider>;
  act(() => {
    renderer = create(
      inStore(
        <>
          <Composer name="page" />
          <ConversationViewContext.Provider value={VIEW}>
            <Composer name="view" />
          </ConversationViewContext.Provider>
        </>
      )
    );
  });
  return { store, composers };
};

it("keeps a file staged in one composer of the room out of the other one's send", () => {
  const { store, composers } = renderTwoComposers();
  const pageFile = fileItem('page.txt');
  const viewFile = fileItem('view.txt');

  act(() => composers.view.attachments.access.append(ROOM_ID, [viewFile]));
  act(() => composers.page.attachments.access.append(ROOM_ID, [pageFile]));

  expect(composers.view.attachments.access.snapshot(ROOM_ID).staged).toEqual([viewFile]);
  expect(composers.page.attachments.access.snapshot(ROOM_ID).staged).toEqual([pageFile]);
  expect(store.get(roomIdToUploadItemsAtomFamily(ROOM_ID))).toEqual([pageFile]);
  expect(store.get(roomIdToUploadItemsAtomFamily(composerStateKey(ROOM_ID, VIEW)))).toEqual([
    viewFile,
  ]);
  // The room page's files are the ones a reload names, and the view's take nothing from them.
  expect(readKeptFileNames(ME, ROOM_ID)).toEqual(['page.txt']);
  act(() => composers.view.attachments.access.remove(ROOM_ID, [viewFile.file]));
  expect(readKeptFileNames(ME, ROOM_ID)).toEqual(['page.txt']);
});

it("uploads a file only while it is staged in its own composer, not in the room page's", async () => {
  const { store, composers } = renderTwoComposers();
  const pageFile = fileItem('page.txt');
  const viewFile = fileItem('view.txt');
  // Both are uploaded already, so the upload itself ends at once.
  [pageFile, viewFile].forEach((item) =>
    store.set(roomUploadAtomFamily(item.file), { mxc: `mxc://example.org/${item.file.name}` })
  );
  act(() => composers.page.attachments.access.append(ROOM_ID, [pageFile]));
  act(() => composers.view.attachments.access.append(ROOM_ID, [viewFile]));

  await expect(
    composers.view.transport.uploadItemWhileStaged(ROOM_ID, pageFile)
  ).resolves.toBeUndefined();
  await expect(composers.view.transport.uploadItemWhileStaged(ROOM_ID, viewFile)).resolves.toBe(
    viewFile
  );
});
