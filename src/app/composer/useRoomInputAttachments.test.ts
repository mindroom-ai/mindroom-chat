import React, { createRef } from 'react';
import { Provider, atom, createStore } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { createEditor, Transforms } from 'slate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Room } from 'matrix-js-sdk';
import { resetEditor } from '../editor/utils';
import {
  composerUploadItemsAtom,
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
  getRoomInputDraftKey,
  clearRoomInputDrafts,
  roomIdToMsgDraftAtomFamily,
} from './roomInputDrafts';
import {
  ConversationViewContext,
  HOME_ASK_VIEW,
  composerStateKey,
} from '../navigation/conversationView';
import * as uploadPreparation from '../matrix/send/roomInputUploadPreparation';
import { TUploadItem, UploadStatus } from '../matrix/state/upload';
import { toMatrixUploadError } from '../matrix/matrix';
import type { PasteMarker } from '../matrix/protocol/pasteAttachmentMarker';
import { UploadBoardHeader } from './upload/UploadBoard';
import { UploadCardRenderer } from './upload/UploadCardRenderer';
import { createRoomInputPasteMarkerElement } from './RoomInputExtensions';
import { handoffComposerDictationSend } from './dictation/dictationSendHandoff';
import type { DictationFinishResult, DictationSession } from './dictation/dictationSession';
import { useRoomInputAttachments } from './useRoomInputAttachments';
import { useRoomInputDraft } from './useRoomInputDraft';

const diagnostics = vi.hoisted(() => ({ buildDiagnosticsExport: vi.fn() }));
const mediaCompressMocks = vi.hoisted(() => ({
  compressImage: vi.fn(),
  compressVideo: vi.fn(),
}));
vi.mock('../lib/media/compressImage', () => ({
  compressImage: (...args: unknown[]) => mediaCompressMocks.compressImage(...args),
}));
vi.mock('../lib/media/compressVideo', () => ({
  compressVideo: (...args: unknown[]) => mediaCompressMocks.compressVideo(...args),
}));
vi.mock('../diagnostics/diagnosticsExport', () => diagnostics);
vi.mock('./commands/CommandAutocomplete', () => ({
  AgentCommandAutocomplete: () => null,
}));
vi.mock('../ui/PendingSendIndicator', () => ({ PendingSendIndicator: () => null }));
vi.mock('../messages/ThreadIndicator', () => ({ ThreadIndicator: () => null }));
vi.mock('./voice/VoiceRecorderDialog', () => ({ VoiceRecorderComposer: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./upload/UploadCardRenderer', () => ({ UploadCardRenderer: () => null }));
vi.mock('./upload/UploadBoard', () => ({
  UploadBoard: ({ children, header }: { children: React.ReactNode; header: React.ReactNode }) =>
    React.createElement(React.Fragment, null, header, children),
  UploadBoardContent: ({ children }: { children: React.ReactNode }) => children,
  UploadBoardHeader: () => null,
}));
vi.mock('folds', () => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => children;
  return {
    Box: Wrapper,
    Dialog: Wrapper,
    Icon: () => null,
    IconButton: Wrapper,
    config: { space: {} },
    Icons: {},
    Overlay: () => null,
    OverlayBackdrop: () => null,
    OverlayCenter: Wrapper,
    Scroll: Wrapper,
    Text: Wrapper,
    toRem: String,
  };
});

const ROOM_ID = '!attachments:example.org';
const createUploadItem = (name: string): TUploadItem => {
  const file = new File(['content'], name, { type: 'text/plain' });
  return { file, originalFile: file, encInfo: undefined, metadata: { markedAsSpoiler: false } };
};
const pasteMarker = {
  id: 'paste-a3f19c',
  chars: 11,
  fileName: 'mindroom-paste-a3f19c.txt',
} as PasteMarker;
const createPasteItem = (): TUploadItem => ({
  ...createUploadItem(pasteMarker.fileName),
  metadata: { markedAsSpoiler: false, mindroomPasteAttachment: pasteMarker },
});
const renderers: ReactTestRenderer[] = [];
afterEach(() => {
  act(() => {
    renderers.splice(0).forEach((renderer) => renderer.unmount());
  });
});

const makeTestRoom = (roomId: string, encrypted = false) =>
  ({
    roomId,
    name: roomId,
    hasEncryptionStateEvent: () => encrypted,
    getMembers: () => [],
  }) as unknown as Room;

const renderHarness = (
  prepare: Parameters<typeof useRoomInputAttachments>[0]['createUploadItems'] = async () => [],
  options?: {
    stagedListKey?: string;
    deferUpload?: boolean;
    sendingDeferred?: boolean;
    view?: string;
    draftKey?: string;
  }
) => {
  const store = createStore();
  const editor = createEditor();
  editor.children = [{ type: 'paragraph', children: [{ text: '' }] }];
  const mx = { cancelUpload: vi.fn() };
  const initialRoom = makeTestRoom(ROOM_ID);
  let feature!: ReturnType<typeof useRoomInputAttachments>;
  let saveDraft!: () => void;
  const Harness = ({
    threadId,
    roomId = ROOM_ID,
    room = initialRoom,
    sendingDeferred = options?.sendingDeferred,
  }: {
    threadId?: string;
    roomId?: string;
    room?: Room;
    sendingDeferred?: boolean;
  }) => {
    saveDraft = useRoomInputDraft(
      editor,
      getRoomInputDraftKey('@tester:example.org', roomId, threadId)
    );
    feature = useRoomInputAttachments({
      mx: mx as never,
      userId: '@tester:example.org',
      room,
      roomId,
      draftKey:
        options?.draftKey ??
        (threadId ? getRoomInputDraftKey('@tester:example.org', roomId, threadId) : undefined),
      editor,
      isMarkdown: true,
      fileDropContainerRef: createRef<HTMLElement>(),
      createUploadItems: prepare,
      stagedListKey: options?.stagedListKey,
      deferUpload: options?.deferUpload,
      sendingDeferred,
    });
    return feature.board;
  };
  const wrap = (
    props: { threadId?: string; roomId?: string; room?: Room; sendingDeferred?: boolean } = {}
  ) =>
    React.createElement(
      Provider,
      { store },
      options?.view !== undefined
        ? React.createElement(
            ConversationViewContext,
            { value: options.view },
            React.createElement(Harness, props)
          )
        : React.createElement(Harness, props)
    );
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(wrap());
  });
  renderers.push(renderer);
  return {
    get feature() {
      return feature;
    },
    store,
    editor,
    renderer,
    mx,
    changeThread: (threadId: string) => act(() => renderer.update(wrap({ threadId }))),
    changeRoom: (roomId: string, room?: Room) =>
      act(() => renderer.update(wrap({ roomId, room: room ?? initialRoom }))),
    setSendingDeferred: (sendingDeferred: boolean) =>
      act(() => renderer.update(wrap({ sendingDeferred }))),
    onEditorChange: () => {
      saveDraft();
      feature.onEditorChange();
    },
  };
};

describe('attachment staging ownership', () => {
  it.each([false, true])(
    'does not recover a delayed paste after logout (preparation failure: %s)',
    async (fails) => {
      let finish!: (items: TUploadItem[]) => void;
      let prepared!: TUploadItem[];
      const harness = renderHarness((files, getMetadata) => {
        prepared = files.map((file, index) => ({
          file,
          originalFile: file,
          encInfo: undefined,
          metadata: getMetadata!(file, index),
          prepError: fails
            ? toMatrixUploadError(new Error('Preparation failed'), 'create')
            : undefined,
        }));
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
      harness.changeThread('$logout');
      act(() => {
        harness.feature.onPaste({
          clipboardData: {
            files: [],
            types: ['text/plain'],
            getData: (type: string) => (type === 'text/plain' ? 'large paste\n'.repeat(6000) : ''),
          },
          preventDefault: vi.fn(),
        } as never);
        harness.renderer.unmount();
        clearRoomInputDrafts('@tester:example.org');
      });
      await act(async () => {
        finish(prepared);
        await Promise.resolve();
      });
      expect(
        harness.store.get(
          roomIdToMsgDraftAtomFamily(
            getRoomInputDraftKey('@tester:example.org', ROOM_ID, '$logout')
          )
        )
      ).toEqual([]);
      expect(harness.feature.access.snapshot(ROOM_ID).staged).toHaveLength(0);
    }
  );

  it.each([false, true])(
    'returns a delayed paste to its starting thread (preparation failure: %s)',
    async (fails) => {
      let finish!: (items: TUploadItem[]) => void;
      let prepared!: TUploadItem[];
      const harness = renderHarness((files, getMetadata) => {
        prepared = files.map((file, index) => ({
          file,
          originalFile: file,
          encInfo: undefined,
          metadata: getMetadata!(file, index),
          prepError: fails
            ? toMatrixUploadError(new Error('Preparation failed'), 'create')
            : undefined,
        }));
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
      harness.changeThread('$paste-source');
      const text = 'large paste\n'.repeat(6000);
      act(() => {
        harness.feature.onPaste({
          clipboardData: {
            files: [],
            types: ['text/plain'],
            getData: (type: string) => (type === 'text/plain' ? text : ''),
          },
          preventDefault: vi.fn(),
        } as never);
      });
      harness.changeThread('$paste-other');
      await act(async () => {
        Transforms.insertText(harness.editor, 'Keep this draft');
        harness.onEditorChange();
        finish(prepared);
        await Promise.resolve();
      });
      expect(harness.editor.children).toEqual([
        { type: 'paragraph', children: [{ text: 'Keep this draft' }] },
      ]);
      expect(harness.feature.access.snapshot().staged).toHaveLength(0);
      harness.changeThread('$paste-source');
      expect(harness.feature.access.snapshot().staged.map((item) => item.file)).toEqual(
        prepared.map((item) => item.file)
      );
      expect(JSON.stringify(harness.editor.children)).toContain(
        fails ? 'large paste' : prepared[0]!.metadata.mindroomPasteAttachment!.fileName
      );
    }
  );

  it('preserves paste files with their thread draft and excludes them from another thread', async () => {
    const harness = renderHarness();
    harness.changeThread('$first');
    const item = createPasteItem();
    await act(async () => {
      Transforms.insertNodes(harness.editor, createRoomInputPasteMarkerElement(pasteMarker));
      harness.feature.access.append(ROOM_ID, [item]);
      harness.onEditorChange();
    });
    harness.changeThread('$second');
    await act(async () => {
      Transforms.insertText(harness.editor, 'Another draft');
      harness.onEditorChange();
    });
    expect(harness.feature.access.snapshot().staged).toHaveLength(0);
    expect(harness.feature.access.snapshot(ROOM_ID).staged.map((entry) => entry.file)).toEqual([
      item.file,
    ]);
    expect(harness.renderer.root.findAllByType(UploadCardRenderer)).toHaveLength(0);
    harness.changeThread('$first');
    expect(JSON.stringify(harness.editor.children)).toContain(pasteMarker.fileName);
    expect(harness.feature.access.snapshot().staged.map((entry) => entry.file)).toEqual([
      item.file,
    ]);
    expect(harness.renderer.root.findAllByType(UploadCardRenderer)).toHaveLength(1);
    await act(async () => {
      resetEditor(harness.editor);
      harness.onEditorChange();
    });
    expect(harness.feature.access.snapshot(ROOM_ID).staged).toHaveLength(0);
  });

  it('attaches app logs as a JSON file, staged like a picked one', async () => {
    diagnostics.buildDiagnosticsExport.mockResolvedValue({
      fileName: 'mindroom-diagnostics-2026-11-17T10-00-00-000Z.json',
      blob: new Blob(['{"metadata":{}}'], { type: 'application/json' }),
    });
    const prepare = vi.fn(async (files: File[]) =>
      files.map((file) => ({
        file,
        originalFile: file,
        encInfo: undefined,
        metadata: { markedAsSpoiler: false },
      }))
    );
    const harness = renderHarness(prepare);

    await act(async () => {
      harness.feature.attachAppLogs();
      await vi.waitFor(() => expect(harness.feature.access.snapshot().staged).toHaveLength(1));
    });

    const [file] = prepare.mock.calls[0]![0];
    expect(file).toBeInstanceOf(File);
    expect(file!.name).toMatch(/^mindroom-diagnostics-.*\.json$/);
    expect(file!.type).toBe('application/json');
    await expect(file!.text()).resolves.toBe('{"metadata":{}}');
    expect(harness.feature.access.snapshot().staged[0]!.file).toBe(file);
  });

  it('drops app logs whose file is still being prepared as the composer moves to another thread', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    diagnostics.buildDiagnosticsExport.mockResolvedValue({
      fileName: 'mindroom-diagnostics-x.json',
      blob: new Blob(['{}']),
    });
    let finishPreparing!: () => void;
    const prepare = vi.fn(
      (files: File[]) =>
        new Promise<TUploadItem[]>((resolve) => {
          finishPreparing = () =>
            resolve(
              files.map((file) => ({
                file,
                originalFile: file,
                encInfo: undefined,
                metadata: { markedAsSpoiler: false },
              }))
            );
        })
    );
    const harness = renderHarness(prepare);
    harness.changeThread('$asked');

    act(() => harness.feature.attachAppLogs());
    await act(async () => {
      await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    });
    harness.changeThread('$other');
    await act(async () => {
      finishPreparing();
      await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    });

    expect(harness.feature.access.snapshot(ROOM_ID).staged).toHaveLength(0);
    warn.mockRestore();
  });

  it('attaches app logs only in the room they were asked for in, never in another', async () => {
    let finishExport!: (built: { fileName: string; blob: Blob }) => void;
    diagnostics.buildDiagnosticsExport.mockReturnValue(
      new Promise((resolve) => {
        finishExport = resolve;
      })
    );
    let finishPreparing!: () => void;
    const prepare = vi.fn(
      (files: File[]) =>
        new Promise<TUploadItem[]>((resolve) => {
          finishPreparing = () =>
            resolve(
              files.map((file) => ({
                file,
                originalFile: file,
                encInfo: undefined,
                metadata: { markedAsSpoiler: false },
              }))
            );
        })
    );
    const harness = renderHarness(prepare);
    const OTHER_ROOM = '!other:example.org';

    // Asked in A, the composer moves to B while the export runs, then back to A while the file
    // is prepared.
    act(() => harness.feature.attachAppLogs());
    harness.changeRoom(OTHER_ROOM);
    await act(async () => {
      finishExport({ fileName: 'mindroom-diagnostics-x.json', blob: new Blob(['{}']) });
      await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    });
    harness.changeRoom(ROOM_ID);
    await act(async () => {
      finishPreparing();
      await vi.waitFor(() =>
        expect(harness.feature.access.snapshot(ROOM_ID).staged).toHaveLength(1)
      );
    });

    expect(harness.feature.access.snapshot(OTHER_ROOM).staged).toHaveLength(0);
    expect(harness.feature.access.snapshot(ROOM_ID).staged[0]!.file.name).toBe(
      'mindroom-diagnostics-x.json'
    );
  });

  it('stages nothing when the app logs cannot be built', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    diagnostics.buildDiagnosticsExport.mockRejectedValue(new Error('storage gone'));
    const prepare = vi.fn(async () => []);
    const harness = renderHarness(prepare);

    await act(async () => {
      harness.feature.attachAppLogs();
      await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    });

    expect(prepare).not.toHaveBeenCalled();
    expect(harness.feature.access.snapshot().staged).toHaveLength(0);
    warn.mockRestore();
  });

  it('defers change listeners until publication completes and honors unsubscribe', async () => {
    const harness = renderHarness();
    const { access } = harness.feature;
    const item = {
      ...createUploadItem('failed.txt'),
      prepError: toMatrixUploadError(new Error('preparation failed'), 'create'),
    };
    const listener = vi.fn(() => access.snapshot());
    const unsubscribe = access.subscribe(listener);
    act(() => {
      access.append(ROOM_ID, [item]);
    });
    expect(listener).not.toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
    });
    expect(listener.mock.results.at(-1)?.value.uploads).toEqual([
      { file: item.file, status: UploadStatus.Error, error: item.prepError },
    ]);
    listener.mockClear();
    act(() => {
      access.remove(ROOM_ID, [item.file]);
    });
    unsubscribe();
    await act(async () => {
      await Promise.resolve();
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it('publishes append, metadata replacement, and removal synchronously', () => {
    const harness = renderHarness();
    const { access } = harness.feature;
    const item = createUploadItem('report.txt');
    act(() => {
      access.append(ROOM_ID, [item]);
      expect(access.snapshot().staged).toEqual([item]);
    });
    const card = harness.renderer.root.findByType(UploadCardRenderer);
    act(() => {
      card.props.setMetadata(item, { markedAsSpoiler: true });
      expect(access.snapshot().staged[0]!.metadata).toEqual({ markedAsSpoiler: true });
      access.remove(ROOM_ID, [item.file]);
      expect(access.snapshot().staged).toEqual([]);
    });
  });

  it('releases a file removed in one composer from the sends of every other', () => {
    const holder = renderHarness();
    const other = renderHarness();
    const item = createUploadItem('cancelled.txt');
    act(() => {
      holder.feature.access.enroll([item]);
      other.feature.access.remove(ROOM_ID, [item.file]);
    });
    expect(holder.feature.access.snapshot().enrolled).toEqual([]);
  });

  it('keeps a file a send claimed as the board changes it', async () => {
    const harness = renderHarness();
    const { access } = harness.feature;
    const item = createUploadItem('photo.png');
    act(() => {
      access.append(ROOM_ID, [item]);
      access.enroll([item]);
    });
    const card = harness.renderer.root.findByType(UploadCardRenderer);
    await act(() => card.props.setMetadata(item, { markedAsSpoiler: true }));
    expect(access.snapshot().enrolled.map((entry) => entry.metadata)).toEqual([
      { markedAsSpoiler: true },
    ]);
  });

  it('keeps recorder enrollment when canceling only board uploads', () => {
    const harness = renderHarness();
    const { access } = harness.feature;
    const selected = createUploadItem('selected.txt');
    const recording = createUploadItem('recording.ogg');
    act(() => {
      access.append(ROOM_ID, [selected]);
      access.enroll([selected, recording]);
      harness.store.set(roomUploadAtomFamily(recording.file), { mxc: 'mxc://example.org/voice' });
      expect(access.snapshot().enrolled).toEqual([selected, recording]);
    });
    const header = harness.renderer.root.findByType(UploadBoardHeader);
    act(() => {
      header.props.onCancel(access.snapshot().uploads);
      expect(access.snapshot().staged).toEqual([]);
      expect(access.snapshot().enrolled).toEqual([recording]);
      expect(access.snapshot().uploads).toEqual([
        { file: recording.file, status: UploadStatus.Success, mxc: 'mxc://example.org/voice' },
      ]);
      // Another session's release leaves this one's files claimed.
      access.clearEnrollment([selected.file]);
      expect(access.snapshot().enrolled).toEqual([recording]);
      access.clearEnrollment([recording.file]);
      expect(access.snapshot().enrolled).toEqual([]);
    });
  });

  it('protects paste companions across editor reset but permits explicit removal', () => {
    const harness = renderHarness();
    const { access } = harness.feature;
    const item = createPasteItem();
    harness.editor.children = [createRoomInputPasteMarkerElement(pasteMarker)];
    act(() => {
      access.append(ROOM_ID, [item]);
      const release = access.protectPasteItems([item]);
      resetEditor(harness.editor);
      harness.feature.onEditorChange();
      expect(access.snapshot().staged).toEqual([item]);
      access.remove(ROOM_ID, [item.file]);
      expect(access.snapshot().staged).toEqual([]);
      release();
    });
  });

  it('cleans orphan paste items after protection is released', () => {
    const harness = renderHarness();
    const { access } = harness.feature;
    const item = createPasteItem();
    act(() => {
      access.append(ROOM_ID, [item]);
      const release = access.protectPasteItems([item]);
      harness.feature.onEditorChange();
      expect(access.snapshot().staged).toEqual([item]);
      release();
      harness.feature.onEditorChange();
      expect(access.snapshot().staged).toEqual([]);
    });
  });

  it('keeps overlapping paste protection until every lease releases', () => {
    const harness = renderHarness();
    const { access } = harness.feature;
    const item = createPasteItem();
    act(() => {
      access.append(ROOM_ID, [item]);
      const releaseFirst = access.protectPasteItems([item]);
      const releaseSecond = access.protectPasteItems([item]);
      releaseFirst();
      releaseFirst();
      harness.feature.onEditorChange();
      expect(access.snapshot().staged).toEqual([item]);
      releaseSecond();
      harness.feature.onEditorChange();
      expect(access.snapshot().staged).toEqual([]);
    });
  });

  it('cleans the owning room after unmount without disturbing another room', () => {
    const harness = renderHarness();
    const { access } = harness.feature;
    const first = createUploadItem('first.txt');
    const second = createUploadItem('second.txt');
    act(() => {
      access.append(ROOM_ID, [first]);
      access.append('!other:example.org', [second]);
      access.enroll([first]);
      harness.renderer.unmount();
      access.remove(ROOM_ID, [first.file]);
      expect(access.snapshot(ROOM_ID).staged).toEqual([]);
      expect(access.snapshot().enrolled).toEqual([]);
      expect(access.snapshot('!other:example.org').staged).toEqual([second]);
    });
  });

  it('tracks hasSendableFiles reactively as staged uploads fail and recover', () => {
    const harness = renderHarness();
    const item = createUploadItem('oversized.bin');
    expect(harness.feature.hasSendableFiles).toBe(false);

    act(() => harness.feature.access.append(ROOM_ID, [item]));
    expect(harness.feature.hasSendableFiles).toBe(true);

    act(() =>
      harness.store.set(roomUploadAtomFamily(item.file), { error: new Error('too large') })
    );
    expect(harness.feature.hasSendableFiles).toBe(false);

    act(() => harness.store.set(roomUploadAtomFamily(item.file), { mxc: 'mxc://example.org/ok' }));
    expect(harness.feature.hasSendableFiles).toBe(true);
  });

  it('keeps deferred Home staged files in one Home list across room switches and prepares/encrypts only on prepareForSend', async () => {
    const createSpy = vi.fn(async () => []);
    const homeKey = 'home-draft';
    const harness = renderHarness(createSpy, {
      stagedListKey: homeKey,
      deferUpload: true,
      view: HOME_ASK_VIEW,
      draftKey: homeKey,
    });
    const encRoom = makeTestRoom('!enc:example.org', true);
    const plainRoom = makeTestRoom('!plain:example.org', false);
    const stagedPaste = createPasteItem();

    // Staging via paste stays local/unencrypted without calling createUploadItems.
    act(() => harness.feature.access.append(ROOM_ID, [stagedPaste]));
    expect(createSpy).not.toHaveBeenCalled();

    // Switching rooms keeps the exact same Home-scoped list without modifying items.
    harness.changeRoom(encRoom.roomId, encRoom);
    expect(harness.store.get(composerUploadItemsAtom(homeKey, HOME_ASK_VIEW))).toEqual([
      stagedPaste,
    ]);
    expect(harness.feature.hasSendableFiles).toBe(true);

    // prepareForSend on encrypted room encrypts from originalFile, preserves metadata & owner, and replaces in-place.
    const encBlob = new File(['cipher'], stagedPaste.originalFile.name, {
      type: 'application/octet-stream',
    });
    const prepSpy = vi
      .spyOn(uploadPreparation, 'createRoomUploadItems')
      .mockResolvedValueOnce([
        {
          file: encBlob,
          originalFile: stagedPaste.originalFile,
          encInfo: { v: 'v2' } as never,
          metadata: stagedPaste.metadata,
        },
      ])
      .mockResolvedValueOnce([
        {
          file: stagedPaste.originalFile,
          originalFile: stagedPaste.originalFile,
          encInfo: undefined,
          metadata: stagedPaste.metadata,
        },
      ]);
    try {
      let preparedEnc!: TUploadItem[];
      await act(async () => {
        preparedEnc = await harness.feature.prepareForSend(encRoom);
      });
      expect(preparedEnc).toHaveLength(1);
      expect(preparedEnc[0]!.file).toBe(encBlob);
      expect(preparedEnc[0]!.encInfo).toBeTruthy();
      expect(harness.feature.access.snapshot().staged).toEqual(preparedEnc);

      // A transient upload error stays retryable via hasSendableFiles and re-prepares cleanly for an unencrypted room.
      act(() => harness.store.set(roomUploadAtomFamily(encBlob), { error: new Error('offline') }));
      expect(harness.feature.hasSendableFiles).toBe(true);
      harness.changeRoom(plainRoom.roomId, plainRoom);
      let preparedPlain!: TUploadItem[];
      await act(async () => {
        preparedPlain = await harness.feature.prepareForSend(plainRoom);
      });
      expect(preparedPlain[0]).toMatchObject({
        file: stagedPaste.originalFile,
        encInfo: undefined,
        metadata: stagedPaste.metadata,
      });
      expect(harness.store.get(roomUploadAtomFamily(stagedPaste.originalFile)).status).toBe(
        UploadStatus.Idle
      );
    } finally {
      prepSpy.mockRestore();
    }
  });

  it('compresses images inline on paste, tracks compressing hasSendableFiles, awaits compression in prepareForSend, cancels on remove, and updates canUseOriginal reactively', async () => {
    vi.stubGlobal('VideoEncoder', class {});
    vi.stubGlobal('VideoDecoder', class {});
    mediaCompressMocks.compressImage.mockReset();
    mediaCompressMocks.compressVideo.mockReset();

    const makeSized = (name: string, type: string, size: number) => {
      const f = new File(['x'], name, { type });
      Object.defineProperty(f, 'size', { value: size });
      return f;
    };

    try {
      // 1. Inline image compression via paste on Home Ask (deferUpload: true).
      const rawImg = makeSized('shot.png', 'image/png', 100 * 1024);
      const compressedImg = makeSized('shot.webp', 'image/webp', 20 * 1024);
      mediaCompressMocks.compressImage.mockResolvedValueOnce({
        file: compressedImg,
        originalSize: rawImg.size,
        compressedSize: compressedImg.size,
      });

      const homeKey = 'home-compress';
      const harness = renderHarness(async () => [], {
        stagedListKey: homeKey,
        deferUpload: true,
        view: HOME_ASK_VIEW,
        draftKey: homeKey,
      });

      await act(async () => {
        harness.feature.onPaste({
          clipboardData: { files: [rawImg], items: [], getData: () => '' },
          preventDefault: vi.fn(),
        } as never);
        await Promise.resolve();
        await Promise.resolve();
      });

      const stagedImg = harness.feature.access.snapshot().staged[0];
      expect(stagedImg).toMatchObject({
        file: compressedImg,
        originalFile: compressedImg,
        compression: {
          status: 'compressed',
          sourceFile: rawImg,
          originalSize: rawImg.size,
        },
      });

      // Reactive canUseOriginal updates when enrolled changes.
      const cardBefore = harness.renderer.root.findByType(UploadCardRenderer);
      expect(cardBefore.props.canUseOriginal).toBe(true);
      act(() => harness.feature.access.enroll([stagedImg!]));
      expect(harness.renderer.root.findByType(UploadCardRenderer).props.canUseOriginal).toBe(false);
      act(() => harness.feature.access.clearEnrollment([stagedImg!.file]));
      expect(harness.renderer.root.findByType(UploadCardRenderer).props.canUseOriginal).toBe(true);

      // Clean out image before testing video prepareForSend.
      act(() => harness.feature.access.remove(ROOM_ID, [stagedImg!.file]));

      // 2. Async video compression + Home Ask prepareForSend awaiting compression + encryption.
      const rawVideo = makeSized('screen.mov', 'video/quicktime', 4 * 1024 * 1024);
      const compressedVideo = makeSized('screen.mp4', 'video/mp4', 700 * 1024);
      const encVideo = makeSized('screen.mp4', 'application/octet-stream', 700 * 1024);
      let resolveVideo!: (val: unknown) => void;
      mediaCompressMocks.compressVideo.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveVideo = resolve;
          })
      );

      await act(async () => {
        harness.feature.onPaste({
          clipboardData: { files: [rawVideo], items: [], getData: () => '' },
          preventDefault: vi.fn(),
        } as never);
        await Promise.resolve();
      });

      expect(harness.feature.access.snapshot().staged[0]?.compression?.status).toBe('compressing');
      expect(harness.feature.hasSendableFiles).toBe(true);
      expect(harness.renderer.root.findByType(UploadBoardHeader).props.compressingCount).toBe(1);

      const encRoom = makeTestRoom('!enc-home:example.org', true);
      const prepSpy = vi.spyOn(uploadPreparation, 'createRoomUploadItems').mockResolvedValueOnce([
        {
          file: encVideo,
          originalFile: compressedVideo,
          encInfo: { v: 'v2' } as never,
          metadata: { markedAsSpoiler: false },
        },
      ]);

      let preparedPromise!: Promise<TUploadItem[]>;
      act(() => {
        preparedPromise = harness.feature.prepareForSend(encRoom);
      });
      await act(async () => {
        resolveVideo({
          file: compressedVideo,
          originalSize: rawVideo.size,
          compressedSize: compressedVideo.size,
        });
        await preparedPromise;
      });
      const prepared = await preparedPromise;
      expect(prepared).toHaveLength(1);
      expect(prepared[0]).toMatchObject({
        file: encVideo,
        originalFile: compressedVideo,
        encInfo: { v: 'v2' },
        compression: { status: 'compressed', sourceFile: rawVideo, originalSize: rawVideo.size },
      });
      prepSpy.mockRestore();

      // 3. Removing a compressing placeholder cancels compression and evicts its roomUploadAtomFamily key.
      const cancelSpy = vi.fn();
      const pendingFile = makeSized('cancel.mov', 'video/quicktime', 2 * 1024 * 1024);
      const placeholder: TUploadItem = {
        file: pendingFile,
        originalFile: pendingFile,
        encInfo: undefined,
        metadata: { markedAsSpoiler: false },
        compression: {
          status: 'compressing',
          progressAtom: atom(0.2),
          cancel: cancelSpy,
          useOriginal: vi.fn(),
          done: Promise.resolve(undefined),
        },
      };
      const removeAtomSpy = vi.spyOn(roomUploadAtomFamily, 'remove');
      act(() => {
        harness.feature.access.append(ROOM_ID, [placeholder]);
        harness.store.set(roomUploadAtomFamily(pendingFile), { status: UploadStatus.Idle });
        harness.feature.access.remove(ROOM_ID, [pendingFile]);
      });
      expect(cancelSpy).toHaveBeenCalledTimes(1);
      expect(removeAtomSpy).toHaveBeenCalledWith(pendingFile);
      removeAtomSpy.mockRestore();

      // 4. Non-deferred room prepareForSend awaits both in-flight stageFiles and compressing video,
      // and hides Use original while waiting on compression.
      const normalImg = makeSized('paste.png', 'image/png', 100 * 1024);
      const normalCompressed = makeSized('paste.webp', 'image/webp', 25 * 1024);
      let resolvePaste!: (val: unknown) => void;
      mediaCompressMocks.compressImage.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePaste = resolve;
          })
      );
      const normalRoom = makeTestRoom(ROOM_ID, false);
      const normalHarness = renderHarness(
        async (files) =>
          files.map((file) => ({
            file,
            originalFile: file,
            encInfo: undefined,
            metadata: { markedAsSpoiler: false },
          })),
        { deferUpload: false }
      );
      act(() => {
        normalHarness.feature.onPaste({
          clipboardData: { files: [normalImg], items: [], getData: () => '' },
          preventDefault: vi.fn(),
        } as never);
      });
      expect(normalHarness.feature.snapshotPendingStaging()).toHaveLength(1);
      const pendingPrepare = normalHarness.feature.prepareForSend(normalRoom);
      await vi.waitFor(() => expect(resolvePaste).toBeTypeOf('function'));
      await act(async () => {
        resolvePaste({
          file: normalCompressed,
          originalSize: normalImg.size,
          compressedSize: normalCompressed.size,
        });
        await pendingPrepare;
      });
      expect(normalHarness.feature.snapshotPendingStaging()).toHaveLength(0);
      expect(await pendingPrepare).toEqual([
        expect.objectContaining({ file: normalCompressed, originalFile: normalCompressed }),
      ]);

      // Clean out image, then verify non-deferred prepareForSend awaits compressing video and hides Use original.
      act(() => normalHarness.feature.access.remove(ROOM_ID, [normalCompressed]));
      const roomRawVideo = makeSized('room.mov', 'video/quicktime', 4 * 1024 * 1024);
      const roomCompVideo = makeSized('room.mp4', 'video/mp4', 800 * 1024);
      let resolveRoomVideo!: (val: unknown) => void;
      mediaCompressMocks.compressVideo.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRoomVideo = resolve;
          })
      );
      await act(async () => {
        normalHarness.feature.onPaste({
          clipboardData: { files: [roomRawVideo], items: [], getData: () => '' },
          preventDefault: vi.fn(),
        } as never);
        await Promise.resolve();
      });
      expect(normalHarness.renderer.root.findByType(UploadCardRenderer).props.canUseOriginal).toBe(
        true
      );
      let roomPreparePromise!: Promise<TUploadItem[]>;
      await act(async () => {
        roomPreparePromise = normalHarness.feature.prepareForSend(normalRoom);
        await Promise.resolve();
      });
      expect(normalHarness.renderer.root.findByType(UploadCardRenderer).props.canUseOriginal).toBe(
        false
      );
      await vi.waitFor(() => expect(resolveRoomVideo).toBeTypeOf('function'));
      await act(async () => {
        resolveRoomVideo({
          file: roomCompVideo,
          originalSize: roomRawVideo.size,
          compressedSize: roomCompVideo.size,
        });
        await roomPreparePromise;
      });
      expect(await roomPreparePromise).toEqual([
        expect.objectContaining({
          file: roomCompVideo,
          compression: {
            status: 'compressed',
            sourceFile: roomRawVideo,
            originalSize: roomRawVideo.size,
          },
        }),
      ]);
      expect(normalHarness.renderer.root.findByType(UploadCardRenderer).props.canUseOriginal).toBe(
        true
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('disables Use original while sendingDeferred is true while keeping explicit Remove separate', async () => {
    mediaCompressMocks.compressImage.mockReset();
    const rawImg = new File(['raw'], 'shot.png', { type: 'image/png' });
    Object.defineProperty(rawImg, 'size', { value: 120 * 1024 });
    const compressedImg = new File(['cmp'], 'shot.webp', { type: 'image/webp' });
    Object.defineProperty(compressedImg, 'size', { value: 24 * 1024 });
    mediaCompressMocks.compressImage.mockResolvedValueOnce({
      file: compressedImg,
      originalSize: rawImg.size,
      compressedSize: compressedImg.size,
    });

    const homeKey = 'home-sending-deferred';
    const harness = renderHarness(async () => [], {
      stagedListKey: homeKey,
      deferUpload: true,
      sendingDeferred: false,
      view: HOME_ASK_VIEW,
      draftKey: homeKey,
    });

    await act(async () => {
      harness.feature.onPaste({
        clipboardData: { files: [rawImg], items: [], getData: () => '' },
        preventDefault: vi.fn(),
      } as never);
      await Promise.resolve();
      await Promise.resolve();
    });

    const cardBefore = harness.renderer.root.findByType(UploadCardRenderer);
    expect(cardBefore.props.canUseOriginal).toBe(true);

    // Once deferred send starts, Use original is hidden and calling onUseOriginal is ignored.
    harness.setSendingDeferred(true);
    const cardDuring = harness.renderer.root.findByType(UploadCardRenderer);
    expect(cardDuring.props.canUseOriginal).toBe(false);
    await act(async () => {
      cardDuring.props.onUseOriginal(harness.feature.access.snapshot().staged[0]);
      await Promise.resolve();
    });
    expect(harness.feature.access.snapshot().staged[0]?.file).toBe(compressedImg);

    // Explicit Remove still works independently while sendingDeferred is true.
    act(() => {
      cardDuring.props.onRemove(compressedImg);
    });
    expect(harness.feature.access.snapshot().staged).toHaveLength(0);

    // Re-enabling after deferred send finishes/fails restores canUseOriginal.
    harness.setSendingDeferred(false);
    const stagedAgain: TUploadItem = {
      file: compressedImg,
      originalFile: compressedImg,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
      compression: { status: 'compressed', sourceFile: rawImg, originalSize: rawImg.size },
    };
    act(() => harness.feature.access.append(ROOM_ID, [stagedAgain]));
    expect(harness.renderer.root.findByType(UploadCardRenderer).props.canUseOriginal).toBe(true);
  });

  it('preserves already-uploaded and compressing explicit items in prepareForSend after ThreadView evicts roomIdToUploadItemsAtomFamily', async () => {
    vi.stubGlobal('VideoEncoder', class {});
    vi.stubGlobal('VideoDecoder', class {});
    mediaCompressMocks.compressVideo.mockReset();

    const VIEW = 'thread-view-evict';
    const encRoom = makeTestRoom(ROOM_ID, true);
    const rawVideo = new File(['raw-video'], 'clip.mov', { type: 'video/quicktime' });
    Object.defineProperty(rawVideo, 'size', { value: 4 * 1024 * 1024 });
    const compressedVideo = new File(['mp4'], 'clip.mp4', { type: 'video/mp4' });
    Object.defineProperty(compressedVideo, 'size', { value: 650 * 1024 });
    const encryptedVideo = new File(['cipher-mp4'], 'clip.mp4', {
      type: 'application/octet-stream',
    });

    let resolveVideo!: (val: unknown) => void;
    mediaCompressMocks.compressVideo.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveVideo = resolve;
        })
    );
    const prepSpy = vi.spyOn(uploadPreparation, 'createRoomUploadItems').mockResolvedValueOnce([
      {
        file: encryptedVideo,
        originalFile: compressedVideo,
        encInfo: { v: 'v2' } as never,
        metadata: { markedAsSpoiler: false },
      },
    ]);

    try {
      const harness = renderHarness(async () => [], { deferUpload: false, view: VIEW });
      harness.changeRoom(ROOM_ID, encRoom);
      const keptShot = createUploadItem('kept-shot.png');
      const removedShot = createUploadItem('removed-shot.png');
      act(() => {
        harness.feature.access.append(ROOM_ID, [keptShot, removedShot]);
        harness.store.set(roomUploadAtomFamily(keptShot.file), { mxc: 'mxc://example.org/kept' });
      });
      await act(async () => {
        harness.feature.onPaste({
          clipboardData: { files: [rawVideo], items: [], getData: () => '' },
          preventDefault: vi.fn(),
        } as never);
        await Promise.resolve();
      });
      await vi.waitFor(() => expect(resolveVideo).toBeTypeOf('function'));

      const videoPlaceholder = harness.feature.access
        .snapshot()
        .staged.find((item) => item.compression?.status === 'compressing')!;
      expect(videoPlaceholder).toBeDefined();

      // Explicitly remove one screenshot before closing ThreadView.
      act(() => {
        harness.feature.access.remove(ROOM_ID, [removedShot.file]);
      });

      const capturedPrepareForSend = harness.feature.prepareForSend;

      // Simulate ThreadView close: unmount composer and evict its atom-family entry.
      act(() => {
        harness.renderer.unmount();
        roomIdToUploadItemsAtomFamily.remove(composerStateKey(ROOM_ID, VIEW));
      });
      expect(harness.store.get(composerUploadItemsAtom(ROOM_ID, VIEW))).toEqual([]);

      // 1. Already-uploaded explicit items (non-compressing path) stay intact; explicitly removed item stays dropped.
      const readyOnly = await capturedPrepareForSend(encRoom, [keptShot, removedShot]);
      expect(readyOnly).toEqual([keptShot]);

      // 2. Mixed already-uploaded screenshot + compressing video awaits compression, encrypts, and keeps both.
      const mixedPromise = capturedPrepareForSend(encRoom, [keptShot, videoPlaceholder]);
      resolveVideo({
        file: compressedVideo,
        originalSize: rawVideo.size,
        compressedSize: compressedVideo.size,
      });
      const mixedReady = await mixedPromise;
      expect(prepSpy).toHaveBeenCalledWith([compressedVideo], encRoom, expect.any(Function));
      expect(mixedReady).toEqual([
        keptShot,
        expect.objectContaining({
          file: encryptedVideo,
          originalFile: compressedVideo,
          encInfo: { v: 'v2' },
          compression: {
            status: 'compressed',
            sourceFile: rawVideo,
            originalSize: rawVideo.size,
          },
        }),
      ]);
    } finally {
      prepSpy.mockRestore();
      vi.unstubAllGlobals();
      roomIdToUploadItemsAtomFamily.remove(composerStateKey(ROOM_ID, VIEW));
    }
  });

  it('delivers already-uploaded screenshot and compressing video on detached dictation Finish & Send after ThreadView eviction', async () => {
    vi.stubGlobal('VideoEncoder', class {});
    vi.stubGlobal('VideoDecoder', class {});
    mediaCompressMocks.compressVideo.mockReset();

    const VIEW = 'thread-dictation-evict';
    const viewKey = composerStateKey(ROOM_ID, VIEW);

    const makeSession = () => {
      let resolveFinish!: (res: DictationFinishResult) => void;
      const finishPromise = new Promise<DictationFinishResult>((resolve) => {
        resolveFinish = resolve;
      });
      const session = {
        getJournalId: () => undefined,
        finish: () => finishPromise,
        retryFailed: vi.fn(),
        takePartialText: () => ({ text: '' }),
        discard: vi.fn(async () => undefined),
        reset: vi.fn(),
      } as unknown as DictationSession;
      return { session, resolveFinish };
    };

    try {
      // Case 1: Already-uploaded screenshot only -> ThreadView closes and evicts family entry -> NOT dropped.
      {
        const plainRoom = makeTestRoom(ROOM_ID, false);
        const harness = renderHarness(async () => [], { deferUpload: false, view: VIEW });
        harness.changeRoom(ROOM_ID, plainRoom);
        const shot = createUploadItem('already-uploaded.png');
        act(() => {
          harness.feature.access.append(ROOM_ID, [shot]);
          harness.store.set(roomUploadAtomFamily(shot.file), { mxc: 'mxc://example.org/shot' });
        });

        const startSendSession = vi.fn(async () => undefined);
        const { session, resolveFinish } = makeSession();
        const mx = {
          getRoom: (id: string) => (id === ROOM_ID ? plainRoom : undefined),
          cancelUpload: vi.fn(),
        };

        act(() => {
          handoffComposerDictationSend({
            store: harness.store,
            mx: mx as never,
            ownerKey: `${ROOM_ID}:thread-only`,
            draftKey: getRoomInputDraftKey('@tester:example.org', ROOM_ID, '$t1'),
            roomName: 'General',
            room: plainRoom,
            roomId: ROOM_ID,
            threadId: '$t1',
            threadingEnabled: true,
            composerContext: { roomId: ROOM_ID, threadId: '$t1' },
            editor: harness.editor,
            session,
            savedSelection: null,
            midTurnMode: 'queue',
            explicitMidTurnMode: false,
            isMarkdown: true,
            ownUserId: '@tester:example.org',
            parseCommands: false,
            commands: {},
            attachments: harness.feature.access,
            sessions: { startSendSession, restoreText: vi.fn() },
            restoreReplyDraft: vi.fn(),
            takeRootModelDraft: () => undefined,
            uploadItem: vi.fn(async () => 'mxc://example.org/shot'),
            prepareAttachmentsForSend: harness.feature.prepareForSend,
            clearReplyDraft: vi.fn(),
            resetComposer: vi.fn(),
            stopTyping: vi.fn(),
          });
        });

        // Simulate ThreadView close before dictation finishes.
        act(() => {
          harness.renderer.unmount();
          roomIdToUploadItemsAtomFamily.remove(viewKey);
        });
        expect(harness.store.get(composerUploadItemsAtom(ROOM_ID, VIEW))).toEqual([]);

        await act(async () => {
          resolveFinish({ status: 'completed', text: 'See attached screenshot' });
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        });
        await vi.waitFor(() => expect(startSendSession).toHaveBeenCalledTimes(1));
        expect(startSendSession).toHaveBeenCalledWith(
          expect.objectContaining({
            textContent: expect.objectContaining({ body: 'See attached screenshot' }),
            batch: { fileItems: [shot] },
          })
        );
        roomIdToUploadItemsAtomFamily.remove(viewKey);
      }

      // Case 2: Already-uploaded screenshot + compressing video in an encrypted ThreadView.
      {
        const encRoom = makeTestRoom(ROOM_ID, true);
        const rawVideo = new File(['raw-video'], 'dict-clip.mov', { type: 'video/quicktime' });
        Object.defineProperty(rawVideo, 'size', { value: 4 * 1024 * 1024 });
        const compressedVideo = new File(['mp4'], 'dict-clip.mp4', { type: 'video/mp4' });
        Object.defineProperty(compressedVideo, 'size', { value: 550 * 1024 });
        const encryptedVideo = new File(['cipher-mp4'], 'dict-clip.mp4', {
          type: 'application/octet-stream',
        });

        let resolveVideo!: (val: unknown) => void;
        mediaCompressMocks.compressVideo.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveVideo = resolve;
            })
        );
        const prepSpy = vi.spyOn(uploadPreparation, 'createRoomUploadItems').mockResolvedValueOnce([
          {
            file: encryptedVideo,
            originalFile: compressedVideo,
            encInfo: { v: 'v2' } as never,
            metadata: { markedAsSpoiler: false },
          },
        ]);

        try {
          const harness = renderHarness(async () => [], { deferUpload: false, view: VIEW });
          harness.changeRoom(ROOM_ID, encRoom);
          const shot: TUploadItem = {
            ...createUploadItem('enc-shot.png'),
            encInfo: { v: 'v2' } as never,
          };
          act(() => {
            harness.feature.access.append(ROOM_ID, [shot]);
            harness.store.set(roomUploadAtomFamily(shot.file), {
              mxc: 'mxc://example.org/enc-shot',
            });
          });
          await act(async () => {
            harness.feature.onPaste({
              clipboardData: { files: [rawVideo], items: [], getData: () => '' },
              preventDefault: vi.fn(),
            } as never);
            await Promise.resolve();
          });
          await vi.waitFor(() => expect(resolveVideo).toBeTypeOf('function'));

          const uploadItem = vi.fn(async () => 'mxc://example.org/enc-vid');
          const startSendSession = vi.fn(async () => undefined);
          const { session, resolveFinish } = makeSession();
          const mx = {
            getRoom: (id: string) => (id === ROOM_ID ? encRoom : undefined),
            cancelUpload: vi.fn(),
          };

          act(() => {
            handoffComposerDictationSend({
              store: harness.store,
              mx: mx as never,
              ownerKey: `${ROOM_ID}:thread-combo`,
              draftKey: getRoomInputDraftKey('@tester:example.org', ROOM_ID, '$t2'),
              roomName: 'General',
              room: encRoom,
              roomId: ROOM_ID,
              threadId: '$t2',
              threadingEnabled: true,
              composerContext: { roomId: ROOM_ID, threadId: '$t2' },
              editor: harness.editor,
              session,
              savedSelection: null,
              midTurnMode: 'queue',
              explicitMidTurnMode: false,
              isMarkdown: true,
              ownUserId: '@tester:example.org',
              parseCommands: false,
              commands: {},
              attachments: harness.feature.access,
              sessions: { startSendSession, restoreText: vi.fn() },
              restoreReplyDraft: vi.fn(),
              takeRootModelDraft: () => undefined,
              uploadItem,
              prepareAttachmentsForSend: harness.feature.prepareForSend,
              clearReplyDraft: vi.fn(),
              resetComposer: vi.fn(),
              stopTyping: vi.fn(),
            });
          });

          // Simulate ThreadView close before dictation and video compression settle.
          act(() => {
            harness.renderer.unmount();
            roomIdToUploadItemsAtomFamily.remove(viewKey);
          });
          expect(harness.store.get(composerUploadItemsAtom(ROOM_ID, VIEW))).toEqual([]);

          await act(async () => {
            resolveFinish({ status: 'completed', text: 'Look at both files' });
            await Promise.resolve();
            await Promise.resolve();
          });
          expect(startSendSession).not.toHaveBeenCalled();

          await act(async () => {
            resolveVideo({
              file: compressedVideo,
              originalSize: rawVideo.size,
              compressedSize: compressedVideo.size,
            });
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
          });
          await vi.waitFor(() => expect(startSendSession).toHaveBeenCalledTimes(1));
          expect(prepSpy).toHaveBeenCalledWith([compressedVideo], encRoom, expect.any(Function));
          expect(uploadItem).toHaveBeenCalledWith(
            expect.objectContaining({
              file: encryptedVideo,
              originalFile: compressedVideo,
              encInfo: { v: 'v2' },
            })
          );
          expect(startSendSession).toHaveBeenCalledWith(
            expect.objectContaining({
              textContent: expect.objectContaining({ body: 'Look at both files' }),
              batch: {
                fileItems: [
                  shot,
                  expect.objectContaining({
                    file: encryptedVideo,
                    originalFile: compressedVideo,
                    encInfo: { v: 'v2' },
                  }),
                ],
              },
            })
          );
        } finally {
          prepSpy.mockRestore();
        }
      }
    } finally {
      vi.unstubAllGlobals();
      roomIdToUploadItemsAtomFamily.remove(viewKey);
    }
  });
});
