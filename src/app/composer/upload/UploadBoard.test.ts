import React from 'react';
import { Provider, atom, createStore, useAtomValue } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  createUploadFamilyObserverAtom,
  type TUploadFamilyObserverAtom,
  type TUploadItem,
  UploadStatus,
} from '../../matrix/state/upload';
import { toMatrixUploadError } from '../../matrix/matrix';
import { zipFile } from '../../lib/media/zipFile';
import { roomIdToUploadItemsAtomFamily, roomUploadAtomFamily } from '../roomInputDrafts';
import { useMediaCompression } from '../useMediaCompression';
import { UploadBoard, UploadBoardHeader } from './UploadBoard';

vi.mock('folds', async () => {
  const reactModule = await import('react');

  const forwardTag =
    (tag: string) =>
    ({
      children,
      ref,
      ...props
    }: Record<string, unknown> & { children?: React.ReactNode; ref?: React.Ref<HTMLElement> }) =>
      reactModule.createElement(tag, { ...props, ref }, children);

  return {
    Badge: forwardTag('span'),
    Box: forwardTag('div'),
    Chip: forwardTag('button'),
    Header: forwardTag('header'),
    Icon: forwardTag('span'),
    Icons: {
      ChevronRight: 'ChevronRight',
      ChevronTop: 'ChevronTop',
      Cross: 'Cross',
      Send: 'Send',
    },
    Spinner: forwardTag('span'),
    Text: forwardTag('span'),
    as:
      (render: (props: Record<string, unknown>, ref: React.Ref<unknown>) => React.ReactNode) =>
      ({ ref, ...props }: Record<string, unknown> & { ref?: React.Ref<unknown> }) =>
        render(props, ref ?? null),
    percent: (min: number, max: number, value: number) => ((value - min) / (max - min)) * 100,
  };
});

vi.mock('../../lib/media/zipFile', () => ({
  zipFile: vi.fn(),
}));

vi.mock('./UploadBoard.css', () => ({
  UploadBoard: 'UploadBoard',
  UploadBoardInline: 'UploadBoardInline',
  UploadBoardBase: 'UploadBoardBase',
  UploadBoardContainer: 'UploadBoardContainer',
  UploadBoardContent: 'UploadBoardContent',
  UploadBoardHeaderContent: 'UploadBoardHeaderContent',
}));

const createFile = (name: string) => new File(['content'], name, { type: 'text/plain' });

describe('UploadBoardHeader', () => {
  it('keeps removal available without rendering a second Send action', async () => {
    const successful = createFile('sendable.txt');
    const failedPrep = createFile('failed.txt');
    const uploadFamilyObserverAtom = atom([
      {
        file: successful,
        status: UploadStatus.Success,
        mxc: 'mxc://mindroom/sendable',
      },
      {
        file: failedPrep,
        status: UploadStatus.Error,
        error: toMatrixUploadError(new Error('encryption failed'), 'create'),
      },
    ]) as TUploadFamilyObserverAtom;
    const onCancel = vi.fn();

    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          Provider,
          { store: createStore() },
          React.createElement(UploadBoardHeader, {
            open: true,
            onToggle: vi.fn(),
            uploadFamilyObserverAtom,
            onCancel,
          })
        )
      );
    });

    const buttons = renderer.root.findAllByType('button');
    expect(
      buttons.some((button) =>
        button.findAllByType('span').some((span) => span.children.includes('Send'))
      )
    ).toBe(false);
    const removeButton = buttons.find((button) =>
      button.findAllByType('span').some((span) => span.children.includes('Remove All'))
    );
    expect(removeButton).toBeTruthy();
    await act(async () => {
      await removeButton?.props.onClick();
    });

    expect(onCancel).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ file: successful })])
    );
  });

  it('renders floating by default and in document flow when inline is true', () => {
    const classes = (inline?: boolean) => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(React.createElement(UploadBoard, { inline, header: 'H' }));
      });
      return tree.root.findAllByType('div').map((node) => node.props.className);
    };
    expect(classes()).toEqual(['UploadBoardBase', 'UploadBoardContainer', 'UploadBoard']);
    expect(classes(true)).toEqual(['UploadBoard UploadBoardInline']);
  });

  it('shows activity spinner when compressingCount > 0 even while board is collapsed and uploads are idle', async () => {
    const file = createFile('clip.mov');
    const uploadFamilyObserverAtom = atom([
      { file, status: UploadStatus.Idle },
    ]) as TUploadFamilyObserverAtom;

    const renderHeader = async (compressingCount: number) => {
      let renderer!: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(
          React.createElement(
            Provider,
            { store: createStore() },
            React.createElement(UploadBoardHeader, {
              open: false,
              onToggle: vi.fn(),
              uploadFamilyObserverAtom,
              compressingCount,
              onCancel: vi.fn(),
            })
          )
        );
      });
      return renderer.root.findAll(
        (node) =>
          node.type === 'span' && node.props.variant === 'Secondary' && node.props.size === '100'
      );
    };

    expect(await renderHeader(0)).toHaveLength(0);
    expect(await renderHeader(1)).toHaveLength(1);
  });

  it('shows failure count badge (1) when collapsed with one failed oversized auto-zip and one sendable item', async () => {
    const store = createStore();
    const roomId = '!collapsed-auto-zip:example.org';
    const room = { roomId, hasEncryptionStateEvent: () => false } as unknown as Room;
    const targetAtom = roomIdToUploadItemsAtomFamily(roomId);
    const failedFile = new File(['x'], 'oversized.bin', { type: 'application/octet-stream' });
    Object.defineProperty(failedFile, 'size', { value: 20 * 1024 * 1024 });
    const sendableFile = createFile('sendable.txt');
    const sendableItem: TUploadItem = {
      file: sendableFile,
      originalFile: sendableFile,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
    };
    store.set(targetAtom, { type: 'PUT', item: sendableItem });
    store.set(roomUploadAtomFamily(sendableFile), { mxc: 'mxc://mindroom/sendable' });
    vi.mocked(zipFile).mockResolvedValueOnce({ status: 'too-large' });

    let api!: ReturnType<typeof useMediaCompression>;
    function CollapsedBoardHarness() {
      const items = useAtomValue(targetAtom);
      const observerAtom = React.useMemo(
        () =>
          createUploadFamilyObserverAtom(
            roomUploadAtomFamily,
            items.map((item) => item.file)
          ),
        [items]
      );
      const current = React.useRef({ room, roomId });
      const owners = React.useRef(new Map());
      const enrolled = React.useRef<TUploadItem[]>([]);
      api = useMediaCompression({
        mx: { getRoom: () => room, cancelUpload: vi.fn() } as unknown as MatrixClient,
        store,
        current,
        deferUpload: false,
        maxUploadSize: 10 * 1024 * 1024,
        owners,
        enrolled,
        getTargetAtom: () => targetAtom,
        keepNames: vi.fn(),
        syncUploadWatches: vi.fn(),
        notify: vi.fn(),
      });
      return React.createElement(UploadBoard, {
        header: React.createElement(UploadBoardHeader, {
          open: false,
          onToggle: vi.fn(),
          uploadFamilyObserverAtom: observerAtom,
          compressingCount: items.filter((item) => item.compression?.status === 'compressing')
            .length,
          onCancel: vi.fn(),
        }),
      });
    }

    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(Provider, { store }, React.createElement(CollapsedBoardHarness))
      );
    });

    const job = api.createPendingAutoZip(failedFile, room, roomId)!;
    await act(async () => {
      store.set(targetAtom, { type: 'PUT', item: job.placeholder });
      job.start();
    });

    await vi.waitFor(() => {
      const badge = renderer.root.find(
        (node) =>
          node.type === 'span' && node.props.variant === 'Critical' && node.props.fill === 'Solid'
      );
      expect(
        badge.find((node) => node.type === 'span' && node.props.size === 'L400').children
      ).toEqual(['1']);
    });
    expect(store.get(targetAtom).find((item) => item.file === failedFile)?.compression).toEqual({
      status: 'zipFailed',
      reason: 'too-large',
    });

    act(() => renderer.unmount());
    roomUploadAtomFamily.remove(failedFile);
    roomUploadAtomFamily.remove(sendableFile);
  });
});
