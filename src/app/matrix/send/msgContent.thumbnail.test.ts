import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TUploadItem } from '../state/upload';
import { getImageMsgContent } from './msgContent';

const mocks = vi.hoisted(() => ({
  loadImageElement: vi.fn(),
  getThumbnail: vi.fn(),
}));

vi.mock('./blurHash', () => ({ encodeBlurHash: () => undefined }));

vi.mock('../../lib/dom', async () => {
  const actual = await vi.importActual<typeof import('../../lib/dom')>('../../lib/dom');
  return { ...actual, loadImageElement: mocks.loadImageElement, getThumbnail: mocks.getThumbnail };
});

const picture = (name: string, type: string, bytes: number): TUploadItem => {
  const file = new File([new Uint8Array(bytes)], name, { type });
  return { file, originalFile: file, encInfo: undefined, metadata: { markedAsSpoiler: false } };
};

const clientUploading = () => {
  const uploadContent = vi.fn(async () => ({ content_uri: 'mxc://example.org/thumb' }));
  return { mx: { uploadContent } as unknown as MatrixClient, uploadContent };
};

describe('getImageMsgContent thumbnails', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:picture');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mocks.loadImageElement.mockReset();
    mocks.getThumbnail.mockReset();
  });

  it('uploads an 800 pixel thumbnail for a picture larger than the timeline shows', async () => {
    mocks.loadImageElement.mockResolvedValue({ width: 2400, height: 1600 });
    mocks.getThumbnail.mockResolvedValue(new Blob([new Uint8Array(100)], { type: 'image/jpeg' }));
    const { mx, uploadContent } = clientUploading();

    const content = await getImageMsgContent(
      mx,
      picture('photo.jpg', 'image/jpeg', 5000),
      'mxc://o'
    );

    expect(mocks.getThumbnail).toHaveBeenCalledWith(expect.anything(), 800, 533, 'image/jpeg');
    expect(uploadContent).toHaveBeenCalledTimes(1);
    expect(content.info).toMatchObject({
      w: 2400,
      h: 1600,
      thumbnail_url: 'mxc://example.org/thumb',
      thumbnail_info: { w: 800, h: 533, mimetype: 'image/jpeg', size: 100 },
    });
  });

  it('keeps transparency in a PNG thumbnail for pictures that are not JPEG', async () => {
    mocks.loadImageElement.mockResolvedValue({ width: 1000, height: 1000 });
    mocks.getThumbnail.mockResolvedValue(new Blob([new Uint8Array(10)], { type: 'image/png' }));
    const { mx } = clientUploading();

    await getImageMsgContent(mx, picture('diagram.png', 'image/png', 5000), 'mxc://o');

    expect(mocks.getThumbnail).toHaveBeenCalledWith(expect.anything(), 800, 800, 'image/png');
  });

  it('sends no thumbnail for small pictures, GIFs, or when it would not be smaller', async () => {
    const { mx, uploadContent } = clientUploading();
    mocks.loadImageElement.mockResolvedValue({ width: 640, height: 480 });
    await getImageMsgContent(mx, picture('small.jpg', 'image/jpeg', 5000), 'mxc://o');

    mocks.loadImageElement.mockResolvedValue({ width: 2000, height: 1000 });
    await getImageMsgContent(mx, picture('moving.gif', 'image/gif', 5000), 'mxc://o');

    mocks.getThumbnail.mockResolvedValue(new Blob([new Uint8Array(6000)], { type: 'image/png' }));
    const content = await getImageMsgContent(mx, picture('flat.png', 'image/png', 5000), 'mxc://o');

    expect(uploadContent).not.toHaveBeenCalled();
    expect(content.info).not.toHaveProperty('thumbnail_url');
  });
});
