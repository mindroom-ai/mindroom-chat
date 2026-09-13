import React, { createRef } from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { createEditor } from 'slate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Room } from 'matrix-js-sdk';
import { resetEditor } from '../../components/editor/utils';
import { TUploadItem, roomUploadAtomFamily } from '../../state/room/roomInputDrafts';
import { UploadStatus } from '../../state/upload';
import { toMatrixUploadError } from '../../utils/matrix';
import { UploadBoardHeader } from '../../components/upload-board';
import { UploadCardRenderer } from '../../components/upload-card';
import { createMindroomRoomInputPasteMarkerElement } from './RoomInputMindroomExtensions';
import { useRoomInputAttachments } from './useRoomInputAttachments';

vi.mock('../../components/editor', async () => ({
  ...(await import('../../components/editor/utils')),
}));
vi.mock('../commands/MindroomCommandAutocomplete', () => ({
  MindroomCommandAutocomplete: () => null,
}));
vi.mock('../messages/pendingSendIndicator', () => ({ PendingSendIndicator: () => null }));
vi.mock('../threads/ThreadIndicator', () => ({ ThreadIndicator: () => null }));
vi.mock('../voice/VoiceRecorderDialog', () => ({ VoiceRecorderComposer: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../components/upload-card', () => ({ UploadCardRenderer: () => null }));
vi.mock('../../components/upload-board', () => ({
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
const pasteMarker = { id: 'paste-a3f19c', chars: 11, fileName: 'mindroom-paste-a3f19c.txt' };
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

const renderHarness = () => {
  const store = createStore();
  const editor = createEditor();
  editor.children = [{ type: 'paragraph', children: [{ text: '' }] }];
  const mx = { cancelUpload: vi.fn() };
  const room = {
    roomId: ROOM_ID,
    name: 'Attachments',
    hasEncryptionStateEvent: () => false,
  } as Room;
  let feature!: ReturnType<typeof useRoomInputAttachments>;
  const Harness = () => {
    feature = useRoomInputAttachments({
      mx: mx as never,
      room,
      roomId: ROOM_ID,
      editor,
      isMarkdown: true,
      fileDropContainerRef: createRef<HTMLElement>(),
      createUploadItems: async () => [],
    });
    return feature.board;
  };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(React.createElement(Provider, { store }, React.createElement(Harness)));
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
  };
};

describe('attachment staging ownership', () => {
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
      expect(access.snapshot().staged[0].metadata).toEqual({ markedAsSpoiler: true });
      access.remove(ROOM_ID, [item.file]);
      expect(access.snapshot().staged).toEqual([]);
    });
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
      access.clearEnrollment();
      expect(access.snapshot().enrolled).toEqual([]);
    });
  });

  it('protects paste companions across editor reset but permits explicit removal', () => {
    const harness = renderHarness();
    const { access } = harness.feature;
    const item = createPasteItem();
    harness.editor.children = [createMindroomRoomInputPasteMarkerElement(pasteMarker)];
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
});
