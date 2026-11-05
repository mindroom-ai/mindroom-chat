import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoContent } from './VideoContent';
import { ReadPdfFile } from './FileContent';

const mocks = vi.hoisted(() => ({
  downloads: [] as Array<(blob: Blob) => void>,
  // One client for every render, as the app's context gives.
  client: {},
}));

vi.mock('../../event-store/cache/attachmentRepository', () => ({
  downloadCachedAttachment: () =>
    new Promise<Blob>((resolve) => {
      mocks.downloads.push(resolve);
    }),
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mocks.client }));
vi.mock('../../ui/media/BlurHash', () => ({ BlurHash: () => null, getInfoBlurHash: () => undefined }));
vi.mock('../../ui/glass/GlassPrimitives', () => ({ Modal: () => null }));
vi.mock('focus-trap-react', () => ({ default: () => null }));
vi.mock('folds', async () => {
  const { createElement } = await import('react');
  const tag =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      createElement(name, props, children);
  return {
    Box: tag('div'),
    Button: tag('button'),
    Chip: tag('button'),
    Icon: () => null,
    IconButton: tag('button'),
    Icons: {},
    Overlay: () => null,
    OverlayBackdrop: () => null,
    OverlayCenter: tag('div'),
    Spinner: () => null,
    Text: tag('span'),
  };
});

const objectUrls: string[] = [];
const revoked: string[] = [];

beforeEach(() => {
  mocks.downloads.length = 0;
  objectUrls.length = 0;
  revoked.length = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const objectUrl = `blob:test/${objectUrls.length}`;
    objectUrls.push(objectUrl);
    return objectUrl;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((objectUrl: string) => {
    revoked.push(objectUrl);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Lets the download and the conversion to a URL run to the end. */
const finishDownload = async () => {
  await act(async () => {
    mocks.downloads.forEach((resolve) => resolve(new Blob(['bytes'])));
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
};

const attachment = { body: 'clip', url: 'mxc://example.org/clip' };

describe('object URLs of attachments that load while their row goes away', () => {
  it('are released when a video finishes loading after it unmounted', async () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <VideoContent
          {...attachment}
          mimeType="video/mp4"
          autoPlay
          renderVideo={({ src }) => <span data-src={src} />}
        />
      );
    });
    expect(mocks.downloads).toHaveLength(1);

    act(() => renderer.unmount());
    await finishDownload();

    expect(objectUrls).toHaveLength(1);
    expect(revoked).toEqual(objectUrls);
  });

  it('are released when a PDF finishes loading after it unmounted', async () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ReadPdfFile {...attachment} mimeType="application/pdf" renderViewer={() => null} />
      );
    });
    act(() => {
      renderer.root.findByType('button').props.onClick();
    });
    expect(mocks.downloads).toHaveLength(1);

    act(() => renderer.unmount());
    await finishDownload();

    expect(objectUrls).toHaveLength(1);
    expect(revoked).toEqual(objectUrls);
  });

  it('are released when the video player unmounts after it loaded', async () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <VideoContent
          {...attachment}
          mimeType="video/mp4"
          autoPlay
          renderVideo={({ src }) => <span data-src={src} />}
        />
      );
    });
    await finishDownload();
    expect(renderer.root.findByProps({ 'data-src': objectUrls[0] })).toBeTruthy();
    expect(revoked).toEqual([]);

    act(() => renderer.unmount());

    expect(revoked).toEqual(objectUrls);
  });
});
