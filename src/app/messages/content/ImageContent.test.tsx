import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AsyncStatus } from '../../lib/hooks/useAsyncCallback';
import { ImageContent } from './ImageContent';
import { ImageGallery } from './ImageGallery';

const mocks = vi.hoisted(() => ({
  downloadCachedAttachment: vi.fn(),
  loadSrcCallback: undefined as (() => Promise<string>) | undefined,
  loadSrc: vi.fn(),
  srcState: {
    status: 'success',
    data: 'blob:image',
  } as { status: string; data?: string },
}));

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  const Wrapper = ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children);
  const Button = React.forwardRef<
    HTMLButtonElement,
    {
      children?: React.ReactNode;
      onClick?: () => void;
    }
  >(({ children, onClick, ...props }, ref) =>
    React.createElement('button', { ...props, onClick, ref }, children)
  );
  const Overlay = ({
    backdrop,
    children,
    open,
  }: {
    backdrop?: React.ReactNode;
    children?: React.ReactNode;
    open?: boolean;
  }) => (open ? React.createElement('div', null, backdrop, children) : null);
  const TooltipProvider = ({
    children,
  }: {
    children?: React.ReactNode | ((triggerRef: undefined) => React.ReactNode);
  }) =>
    typeof children === 'function'
      ? React.createElement(React.Fragment, null, children(undefined))
      : React.createElement(React.Fragment, null, children);
  const as = (component: Parameters<typeof React.forwardRef>[0]) => React.forwardRef(component);

  return {
    ...actual,
    Badge: Wrapper,
    Box: Wrapper,
    Button,
    Chip: Button,
    Icon: (props: Record<string, unknown>) => React.createElement('span', props),
    Icons: new Proxy(
      {},
      {
        get: (_target, key) => String(key),
      }
    ),
    Modal: Wrapper,
    Overlay,
    OverlayBackdrop: Wrapper,
    OverlayCenter: Wrapper,
    Spinner: Wrapper,
    Text: Wrapper,
    Tooltip: Wrapper,
    TooltipProvider,
    as,
  };
});

vi.mock('./style.css', () => ({
  AbsoluteContainer: 'AbsoluteContainer',
  Blur: 'Blur',
  RelativeBase: 'RelativeBase',
}));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));

vi.mock('../../lib/hooks/useAsyncCallback', async () => {
  const actual = await vi.importActual<typeof import('../../lib/hooks/useAsyncCallback')>(
    '../../lib/hooks/useAsyncCallback'
  );

  return {
    ...actual,
    useAsyncCallback: (callback: () => Promise<string>) => {
      mocks.loadSrcCallback = callback;
      return [mocks.srcState, mocks.loadSrc];
    },
  };
});

vi.mock('../../lib/hooks/useBlobUrlCleanup', () => ({
  revokeBlobUrl: vi.fn(),
  useBlobUrlCleanup: () => undefined,
}));

vi.mock('../../event-store/cache/attachmentRepository', () => ({
  downloadCachedAttachment: mocks.downloadCachedAttachment,
}));

vi.mock('./serverThumbnail', async () => ({
  ...(await vi.importActual<typeof import('./serverThumbnail')>('./serverThumbnail')),
  loadServerScaledPicture: (_mx: unknown, _url: string, loadOriginal: () => Promise<string>) =>
    loadOriginal(),
}));

// The viewer session has its own tests (ImageGallery.test.tsx); here only what it is handed.
vi.mock('./ImageGallery', () => ({ ImageGallery: () => null }));

vi.mock('../../matrix/matrix', () => ({
  decryptFile: vi.fn(),
  mxcUrlToHttp: () => 'https://example.test/image',
}));

const OWNER = { roomId: '!room:example.org', eventId: '$image', revisionTs: 5 };
const FILE = {
  url: 'mxc://mindroom/image',
  key: { alg: 'A256CTR', ext: true, k: 'key', key_ops: ['encrypt', 'decrypt'], kty: 'oct' },
  iv: 'iv',
  hashes: { sha256: 'hash' },
  v: 'v2',
};

describe('ImageContent', () => {
  let renderer: ReactTestRenderer | undefined;

  const renderImageContent = ({ mimeType }: { mimeType?: string }) => {
    act(() => {
      renderer = create(
        React.createElement(ImageContent, {
          body: 'Test image',
          mimeType,
          url: 'mxc://mindroom/image',
          info: { w: 4, h: 3 },
          encInfo: FILE,
          owner: OWNER,
          renderImage: ({ onClick, ...props }) =>
            React.createElement('button', { ...props, 'data-role': 'image', onClick }),
        })
      );
    });
    return renderer!;
  };

  beforeEach(() => {
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:image',
    };
    mocks.loadSrc.mockReset();
    mocks.downloadCachedAttachment.mockReset();
  });

  afterEach(() => {
    if (renderer)
      act(() => {
        renderer?.unmount();
      });
    renderer = undefined;
    vi.restoreAllMocks();
  });

  it.each([
    ['image/svg+xml', 'application/octet-stream'],
    ['image/png', 'image/png'],
  ])('loads an image declared as %s with blob type %s', async (declaredType, blobType) => {
    mocks.downloadCachedAttachment.mockResolvedValue(new Blob(['image']));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:image');
    renderImageContent({ mimeType: declaredType });

    await mocks.loadSrcCallback?.();

    expect(mocks.downloadCachedAttachment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mimeType: blobType })
    );
  });

  it('opens the viewer on its own picture when clicked, and closes it when the viewer asks', () => {
    const tree = renderImageContent({ mimeType: 'image/png' });
    expect(tree.root.findAllByType(ImageGallery)).toHaveLength(0);

    act(() => {
      tree.root.findByProps({ 'data-role': 'image' }).props.onClick();
    });
    const gallery = tree.root.findByType(ImageGallery);
    expect(gallery.props.slide).toEqual({
      eventId: '$image',
      body: 'Test image',
      url: 'mxc://mindroom/image',
      mimeType: 'image/png',
      info: { w: 4, h: 3 },
      encInfo: FILE,
      owner: OWNER,
    });

    act(() => {
      gallery.props.requestClose();
    });
    expect(tree.root.findAllByType(ImageGallery)).toHaveLength(0);
  });

  it('opens the viewer on Enter', () => {
    const tree = renderImageContent({ mimeType: 'image/png' });
    const preventDefault = vi.fn();
    act(() => {
      tree.root
        .findByProps({ 'data-role': 'image' })
        .props.onKeyDown({ key: 'Enter', preventDefault });
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(tree.root.findAllByType(ImageGallery)).toHaveLength(1);
  });
});
