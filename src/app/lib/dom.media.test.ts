// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getThumbnail, loadImageElement, loadVideoElement } from './dom';

afterEach(() => {
  vi.restoreAllMocks();
});

// jsdom never loads media, so the tests fire the element's events by hand.
const settleLater = (event: 'load' | 'loadeddata' | 'error') => {
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const element = create(tag);
    if (tag === 'img' || tag === 'video') {
      Object.defineProperty(element, 'src', {
        configurable: true,
        set: () => queueMicrotask(() => element.dispatchEvent(new Event(event))),
      });
    }
    return element;
  }) as typeof document.createElement);
};

describe('loadImageElement', () => {
  it('resolves with the image once it loads', async () => {
    settleLater('load');
    const img = await loadImageElement('blob:image');
    expect(img.localName).toBe('img');
  });

  it('rejects naming the url when the image fails', async () => {
    settleLater('error');
    await expect(loadImageElement('blob:broken')).rejects.toThrow(
      'Could not load image blob:broken'
    );
  });
});

describe('loadVideoElement', () => {
  it('resolves with a muted, inline video with metadata preloading once a frame is ready', async () => {
    settleLater('loadeddata');
    const video = await loadVideoElement('blob:video');
    expect(video.preload).toBe('metadata');
    expect(video.playsInline).toBe(true);
    expect(video.muted).toBe(true);
  });

  it('rejects naming the url when the video fails', async () => {
    settleLater('error');
    await expect(loadVideoElement('blob:broken')).rejects.toThrow(
      'Could not load video blob:broken'
    );
  });
});

describe('getThumbnail', () => {
  const stubCanvas = (context: unknown, blob: Blob | null) => {
    const drawn = { width: 0, height: 0 };
    const canvas = {
      get width() {
        return drawn.width;
      },
      set width(value: number) {
        drawn.width = value;
      },
      get height() {
        return drawn.height;
      },
      set height(value: number) {
        drawn.height = value;
      },
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback: BlobCallback) => callback(blob)),
    };
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? canvas : create(tag)) as typeof document.createElement);
    return canvas;
  };

  it('draws at the requested size and encodes with the requested type', async () => {
    const drawImage = vi.fn();
    const blob = new Blob(['x'], { type: 'image/png' });
    const canvas = stubCanvas({ drawImage }, blob);
    const source = {} as CanvasImageSource;

    await expect(getThumbnail(source, 40, 30, 'image/png')).resolves.toBe(blob);

    expect(canvas.width).toBe(40);
    expect(canvas.height).toBe(30);
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 40, 30);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
  });

  it('defaults to JPEG', async () => {
    const canvas = stubCanvas({ drawImage: vi.fn() }, new Blob(['x']));
    await getThumbnail({} as CanvasImageSource, 1, 1);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg');
  });

  it('resolves undefined without a 2d context', async () => {
    const canvas = stubCanvas(null, null);
    await expect(getThumbnail({} as CanvasImageSource, 1, 1)).resolves.toBeUndefined();
    expect(canvas.toBlob).not.toHaveBeenCalled();
  });

  it('resolves undefined when encoding yields no blob', async () => {
    stubCanvas({ drawImage: vi.fn() }, null);
    await expect(getThumbnail({} as CanvasImageSource, 1, 1)).resolves.toBeUndefined();
  });
});
