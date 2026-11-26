import React from 'react';
import { Provider, atom, createStore } from 'jotai';
import { MatrixError } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadCardRenderer } from './UploadCardRenderer';
import { TUploadContent, toMatrixUploadError } from '../../matrix/matrix';

const uploadMock = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- the types do not check without it
  upload: undefined as unknown,
  startUpload: vi.fn(),
  cancelUpload: vi.fn(),
  roomUploadAtomFamily: vi.fn(() => 'room-upload-atom'),
  mediaConfig: {},
  useBindUploadAtom: vi.fn(),
}));

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
    Icon: forwardTag('span'),
    IconButton: forwardTag('button'),
    Icons: {
      Check: 'Check',
      Cross: 'Cross',
      EyeBlind: 'EyeBlind',
      File: 'File',
      Photo: 'Photo',
      Play: 'Play',
      Vlc: 'Vlc',
      Warning: 'Warning',
    },
    ProgressBar: forwardTag('progress'),
    Text: forwardTag('span'),
    color: {
      Success: {
        Main: 'green',
      },
    },
    config: {
      radii: {
        R300: '8px',
      },
      space: {
        S100: '4px',
      },
    },
    percent: (min: number, max: number, value: number) => ((value - min) / (max - min)) * 100,
    toRem: (value: number) => `${value / 16}rem`,
  };
});

vi.mock('./UploadCard.css', () => ({
  UploadCard: () => 'upload-card',
  UploadCardError: 'upload-card-error',
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));

vi.mock('../../matrix/hooks/useMediaConfig', () => ({
  useMediaConfig: () => uploadMock.mediaConfig,
}));

vi.mock('../../lib/hooks/useObjectURL', () => ({
  useObjectURL: () => undefined,
}));

vi.mock('../../matrix/state/upload', () => ({
  UploadStatus: {
    Idle: 'idle',
    Loading: 'loading',
    Success: 'success',
    Error: 'error',
  },
  useBindUploadAtom: (...args: unknown[]) => {
    uploadMock.useBindUploadAtom(...args);
    return {
      upload: uploadMock.upload,
      startUpload: uploadMock.startUpload,
      cancelUpload: uploadMock.cancelUpload,
    };
  },
}));

vi.mock('../roomInputDrafts', () => ({
  roomUploadAtomFamily: uploadMock.roomUploadAtomFamily,
}));

const friendlyTransientMessage = "Couldn't send — your connection dropped. Try again.";
const prepareUploadMessage = "Couldn't prepare file for upload.";

const createFile = (overrides: Partial<TUploadContent> = {}): TUploadContent =>
  ({
    name: 'image.png',
    size: 1024,
    type: 'image/png',
    ...overrides,
  }) as TUploadContent;

const setUploadError = (
  file: TUploadContent,
  error = new MatrixError({ errcode: 'M_UNKNOWN', error: '' })
) => {
  uploadMock.upload = {
    file,
    status: 'error',
    error,
  };
};

const renderText = (node: React.ReactElement): string => {
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(node);
  });
  return JSON.stringify(renderer?.toJSON());
};

describe('upload card renderers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadMock.mediaConfig = {};
  });

  it('renders friendly transient MatrixError text in the full upload card', () => {
    const file = createFile();
    setUploadError(file);

    const output = renderText(
      React.createElement(UploadCardRenderer, {
        fileItem: {
          file,
          originalFile: file,
          // Unencrypted: the upload keeps its file name.
          encInfo: undefined,
          // Not marked as a spoiler.
          metadata: { markedAsSpoiler: false },
        },
        setMetadata: vi.fn(),
        onRemove: vi.fn(),
      })
    );

    expect(output).toContain(friendlyTransientMessage);
    expect(output).not.toContain('M_UNKNOWN: Unknown message');
  });

  it('renders local prep errors without retrying an unsafe upload', () => {
    const file = createFile();
    uploadMock.upload = {
      file,
      status: 'idle',
    };

    const output = renderText(
      React.createElement(UploadCardRenderer, {
        fileItem: {
          file,
          // A prep error alone has to keep the card from uploading.
          originalFile: file,
          encInfo: undefined,
          // The spoiler flag plays no part in that.
          metadata: { markedAsSpoiler: false },
          prepError: toMatrixUploadError(new Error('encryption failed'), 'create'),
        },
        setMetadata: vi.fn(),
        onRemove: vi.fn(),
      })
    );

    expect(uploadMock.startUpload).not.toHaveBeenCalled();
    expect(output).toContain(prepareUploadMessage);
    expect(output).not.toContain('Retry');
  });

  it('binds encrypted-room prep-error items with a plaintext upload block', () => {
    const file = createFile();
    const prepError = toMatrixUploadError(new Error('encryption failed'), 'create');
    uploadMock.upload = {
      file,
      status: 'idle',
    };

    renderText(
      React.createElement(UploadCardRenderer, {
        isEncrypted: true,
        fileItem: {
          file,
          // The room is encrypted, yet the file has no encryption info.
          originalFile: file,
          encInfo: undefined,
          // Spoiler flag off, as in the other cases.
          metadata: { markedAsSpoiler: false },
          prepError,
        },
        setMetadata: vi.fn(),
        onRemove: vi.fn(),
      })
    );

    expect(uploadMock.useBindUploadAtom).toHaveBeenCalledWith(
      expect.anything(),
      'room-upload-atom',
      expect.objectContaining({
        hideFilename: false,
        blockUploadError: prepError,
      })
    );
  });

  it('defers upload, hides idle encryption error and Retry chip, but still shows too-large and prep errors when autoUpload is false', () => {
    const file = createFile({ size: 2048 });
    uploadMock.upload = { file, status: 'idle' };

    // Idle in an encrypted room: no auto-start and no premature encryption error.
    const idleOut = renderText(
      React.createElement(UploadCardRenderer, {
        isEncrypted: true,
        autoUpload: false,
        fileItem: {
          file,
          originalFile: file,
          encInfo: undefined,
          metadata: { markedAsSpoiler: false },
        },
        setMetadata: vi.fn(),
        onRemove: vi.fn(),
      })
    );
    expect(uploadMock.startUpload).not.toHaveBeenCalled();
    expect(idleOut).not.toContain(prepareUploadMessage);

    // Oversized file still reports too-large immediately when autoUpload is false.
    uploadMock.mediaConfig = { 'm.upload.size': 1024 };
    const largeOut = renderText(
      React.createElement(UploadCardRenderer, {
        autoUpload: false,
        fileItem: {
          file,
          originalFile: file,
          encInfo: undefined,
          metadata: { markedAsSpoiler: false },
        },
        setMetadata: vi.fn(),
        onRemove: vi.fn(),
      })
    );
    expect(largeOut).toContain('too large');

    // Transient error hides inline Retry chip when autoUpload is false (retry goes through Send).
    uploadMock.mediaConfig = {};
    setUploadError(file);
    const errOut = renderText(
      React.createElement(UploadCardRenderer, {
        autoUpload: false,
        fileItem: {
          file,
          originalFile: file,
          encInfo: undefined,
          metadata: { markedAsSpoiler: false },
        },
        setMetadata: vi.fn(),
        onRemove: vi.fn(),
      })
    );
    expect(errOut).toContain(friendlyTransientMessage);
    expect(errOut).not.toContain('Retry');
  });

  it('suppresses unencrypted and too-large errors while compressing, blocks upload, renders progress, and wires Use original', () => {
    const file = createFile({
      name: 'recording.mov',
      type: 'video/quicktime',
      size: 80 * 1024 * 1024,
    });
    const progressAtom = atom(0.37);
    const onUseOriginal = vi.fn();
    const store = createStore();
    uploadMock.mediaConfig = { 'm.upload.size': 50 * 1024 * 1024 };
    uploadMock.upload = { file, status: 'idle' };

    const fileItem = {
      file,
      originalFile: file,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
      compression: {
        status: 'compressing' as const,
        progressAtom,
        cancel: vi.fn(),
        useOriginal: vi.fn(),
      },
    };

    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(UploadCardRenderer, {
            isEncrypted: true,
            fileItem,
            setMetadata: vi.fn(),
            onRemove: vi.fn(),
            onUseOriginal,
          })
        )
      );
    });

    const initial = JSON.stringify(renderer.toJSON());
    expect(uploadMock.startUpload).not.toHaveBeenCalled();
    expect(uploadMock.useBindUploadAtom).toHaveBeenCalledWith(
      expect.anything(),
      'room-upload-atom',
      expect.objectContaining({
        blockUploadError: expect.any(MatrixError),
      })
    );
    expect(initial).toContain('Compressing...');
    expect(initial).toContain('37%');
    expect(initial).toContain('Use original');
    expect(initial).not.toContain(prepareUploadMessage);
    expect(initial).not.toContain('too large');

    // Updating progressAtom updates the percentage reactively.
    act(() => {
      store.set(progressAtom, 0.82);
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('82%');

    const useOriginalBtn = renderer.root
      .findAllByType('button')
      .find((btn) =>
        btn.findAllByType('span').some((span) => span.children.includes('Use original'))
      );
    expect(useOriginalBtn).toBeDefined();
    act(() => {
      useOriginalBtn?.props.onClick();
    });
    expect(onUseOriginal).toHaveBeenCalledWith(fileItem);
  });

  it('renders original to compressed size delta and hides Use original when enrolled', () => {
    const sourceFile = new File(['raw'], 'shot.png', { type: 'image/png' });
    const compressedFile = createFile({
      name: 'shot.webp',
      type: 'image/webp',
      size: 256 * 1024,
    });
    uploadMock.upload = { file: compressedFile, status: 'success', mxc: 'mxc://example/1' };
    const onUseOriginal = vi.fn();

    const fileItem = {
      file: compressedFile,
      originalFile: compressedFile,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
      compression: {
        status: 'compressed' as const,
        sourceFile,
        originalSize: 2 * 1024 * 1024,
      },
    };

    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        React.createElement(UploadCardRenderer, {
          fileItem,
          setMetadata: vi.fn(),
          onRemove: vi.fn(),
          onUseOriginal,
          canUseOriginal: true,
        })
      );
    });
    const output = JSON.stringify(renderer.toJSON());
    expect(output).toContain('2.1 MB → 262.1 KB');
    expect(output).toContain('Use original');

    const useOriginalBtn = renderer.root
      .findAllByType('button')
      .find((btn) =>
        btn.findAllByType('span').some((span) => span.children.includes('Use original'))
      );
    act(() => {
      useOriginalBtn?.props.onClick();
    });
    expect(onUseOriginal).toHaveBeenCalledWith(fileItem);

    // Enrolled in active send: Use original is hidden.
    act(() => {
      renderer.update(
        React.createElement(UploadCardRenderer, {
          fileItem,
          setMetadata: vi.fn(),
          onRemove: vi.fn(),
          onUseOriginal,
          canUseOriginal: false,
        })
      );
    });
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Use original');
  });
});
