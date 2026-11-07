import 'fake-indexeddb/auto';
import React, { createRef } from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createEditor, type Descendant } from 'slate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import type { TUploadItem, TUploadMetadata } from '../matrix/state/upload';
import { createPasteMarker } from '../matrix/protocol/pasteAttachmentMarker';
import { getRoomInputDraftKey, roomIdToMsgDraftAtomFamily } from './roomInputDrafts';
import { clearKeptPastes, keepPasteText, readKeptPasteTexts } from './keptPastes';
import {
  createRoomInputPasteMarkerElement,
  getRoomInputPasteMarkerFileNames,
} from './RoomInputExtensions';
import { useRoomInputAttachments } from './useRoomInputAttachments';
import { useRoomInputDraft } from './useRoomInputDraft';

vi.mock('./commands/CommandAutocomplete', () => ({ AgentCommandAutocomplete: () => null }));
vi.mock('../ui/PendingSendIndicator', () => ({ PendingSendIndicator: () => null }));
vi.mock('../messages/ThreadIndicator', () => ({ ThreadIndicator: () => null }));
vi.mock('./voice/VoiceRecorderDialog', () => ({ VoiceRecorderComposer: () => null }));
vi.mock('./upload/UploadCardRenderer', () => ({ UploadCardRenderer: () => null }));
vi.mock('./upload/UploadBoard', () => ({
  UploadBoard: () => null,
  UploadBoardContent: () => null,
  UploadBoardHeader: () => null,
}));

// A draft with a large paste comes back after a reload with the chip but without its file, which
// lived only in memory. The paste's text was kept, so the composer stages the file again; a chip
// whose text was not kept leaves the draft with a notice instead of being sent without a file.
const USER = '@tester:example.org';
const ROOM_ID = '!pastes:example.org';
const LOG = 'step done\n'.repeat(20_000);
const marker = { id: 'paste-a3f19c', chars: LOG.length, fileName: 'mindroom-paste-a3f19c.txt' };

const prepare = async (
  files: File[],
  getMetadata?: (file: File, index: number) => TUploadMetadata
): Promise<TUploadItem[]> =>
  files.map((file, index) => ({
    file,
    originalFile: file,
    encInfo: undefined,
    metadata: getMetadata ? getMetadata(file, index) : { markedAsSpoiler: false },
  }));

const draftWithPaste = (): Descendant[] => [
  {
    type: 'paragraph',
    children: [
      { text: 'Here is the log: ' },
      createRoomInputPasteMarkerElement({ ...marker, raw: createPasteMarker(marker) }),
      { text: '' },
    ],
  } as unknown as Descendant,
];

const renderers: ReactTestRenderer[] = [];
afterEach(async () => {
  act(() => {
    renderers.splice(0).forEach((renderer) => renderer.unmount());
  });
  await clearKeptPastes(USER);
});

/** A composer opened on the draft a reload restores, with nothing staged. */
const openRestoredDraft = async () => {
  const store = createStore();
  store.set(roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(USER, ROOM_ID)), draftWithPaste());
  const editor = createEditor();
  editor.children = [{ type: 'paragraph', children: [{ text: '' }] } as Descendant];
  const room = { roomId: ROOM_ID, name: 'Log review', hasEncryptionStateEvent: () => false };
  let feature!: ReturnType<typeof useRoomInputAttachments>;
  const Harness = () => {
    useRoomInputDraft(editor, USER, ROOM_ID);
    feature = useRoomInputAttachments({
      mx: { cancelUpload: vi.fn() } as never,
      userId: USER,
      room: room as unknown as Room,
      roomId: ROOM_ID,
      editor,
      isMarkdown: true,
      fileDropContainerRef: createRef<HTMLElement>(),
      createUploadItems: prepare,
    });
    return null;
  };
  await act(async () => {
    renderers.push(create(React.createElement(Provider, { store }, React.createElement(Harness))));
  });
  // The kept text is read from IndexedDB.
  await act(async () => {
    await feature.settlePastes();
  });
  return {
    editor,
    get feature() {
      return feature;
    },
  };
};

describe('large pastes in a draft restored after a reload', () => {
  it('stages the paste file again from the text kept with the draft', async () => {
    await keepPasteText(USER, getRoomInputDraftKey(USER, ROOM_ID), marker.fileName, LOG);
    const composer = await openRestoredDraft();
    const { editor, feature } = composer;
    const staged = feature.access.snapshot().staged;
    expect(staged.map((item) => item.metadata.mindroomPasteAttachment)).toEqual([marker]);
    expect(await staged[0]!.file.text()).toBe(LOG);
    expect([...getRoomInputPasteMarkerFileNames(editor.children)]).toEqual([marker.fileName]);
    expect(feature.lostPastes).toBe(false);
    expect(await feature.settlePastes()).toBe(true);
  });

  it('takes a chip whose text was not kept out of the draft, with a notice', async () => {
    const composer = await openRestoredDraft();
    expect(composer.feature.access.snapshot().staged).toEqual([]);
    expect(getRoomInputPasteMarkerFileNames(composer.editor.children).size).toBe(0);
    expect(JSON.stringify(composer.editor.children)).toContain('Here is the log: ');
    expect(composer.feature.lostPastes).toBe(true);
    act(() => composer.feature.dismissLostPastes());
    expect(composer.feature.lostPastes).toBe(false);
  });

  it('keeps the text of a new paste with its draft', async () => {
    const composer = await openRestoredDraft();
    const text = 'x'.repeat(80_000);
    const clipboardData = {
      files: [],
      getData: (type: string) => (type === 'text/plain' ? text : ''),
    };
    await act(async () => {
      composer.feature.onPaste({
        clipboardData,
        preventDefault: vi.fn(),
      } as unknown as React.ClipboardEvent<HTMLElement>);
    });
    const name = composer.feature.access
      .snapshot()
      .staged.map((item) => item.metadata.mindroomPasteAttachment?.fileName)
      .find(Boolean)!;
    await expect.poll(async () => (await readKeptPasteTexts(USER, [name])).get(name)).toBe(text);
  });
});
