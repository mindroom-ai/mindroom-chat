// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getThumbnail,
  loadImageElement,
  loadVideoElement,
  VIDEO_FRAME_WAIT_MS,
  VIDEO_LOAD_TIMEOUT_MS,
} from './dom';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
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
  // jsdom implements neither play nor pause.
  const stubPlayback = (play: () => Promise<void> = () => Promise.resolve()) => ({
    play: vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play),
    pause: vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined),
  });

  it('resolves with a muted, inline video with metadata preloading once a frame is ready', async () => {
    settleLater('loadeddata');
    const { play, pause } = stubPlayback();
    const video = await loadVideoElement('blob:video');
    expect(video.preload).toBe('metadata');
    expect(video.playsInline).toBe(true);
    expect(video.muted).toBe(true);
    // iOS WebKit decodes no first frame of a video that never plays.
    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('rejects when no frame arrives in time, also when playing is refused', async () => {
    vi.useFakeTimers();
    try {
      stubPlayback(() => Promise.reject(new DOMException('refused', 'NotAllowedError')));
      const loading = loadVideoElement('blob:silent');
      const settled = expect(loading).rejects.toThrow(
        `Could not load video blob:silent within ${VIDEO_LOAD_TIMEOUT_MS} ms`
      );
      await vi.advanceTimersByTimeAsync(VIDEO_LOAD_TIMEOUT_MS);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects naming the url when the video fails', async () => {
    settleLater('error');
    stubPlayback();
    await expect(loadVideoElement('blob:broken')).rejects.toThrow(
      'Could not load video blob:broken'
    );
  });

  /**
   * The next video `loadVideoElement` creates, in a browser that tells when it shows a frame
   * (`requestVideoFrameCallback`). `showFrame` runs the pending frame callbacks.
   */
  const fakeVideo = (videoWidth = 1206) => {
    const video = document.createElement('video');
    let frameCallbacks: Array<() => void> = [];
    Object.defineProperties(video, {
      videoWidth: { value: videoWidth },
      requestVideoFrameCallback: {
        value: (callback: () => void) => frameCallbacks.push(callback),
      },
    });
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'video' ? video : create(tag)) as typeof document.createElement);
    return {
      video,
      loaded: () => video.dispatchEvent(new Event('loadeddata')),
      showFrame: () => {
        const callbacks = frameCallbacks;
        frameCallbacks = [];
        callbacks.forEach((callback) => callback());
      },
    };
  };

  /** Whether `promise` has settled, once the microtasks it waits on have run. */
  const settled = async (promise: Promise<unknown>): Promise<boolean> => {
    let done = false;
    const mark = () => {
      done = true;
    };
    promise.then(mark, mark);
    for (let tick = 0; tick < 10; tick += 1) {
      await Promise.resolve();
    }
    return done;
  };

  // Safari fires `loadeddata` before it can draw the frame: the thumbnail came out black.
  it('waits after loadeddata until the browser has shown a frame', async () => {
    const { pause } = stubPlayback();
    const { video, loaded, showFrame } = fakeVideo();
    const loading = loadVideoElement('blob:video');

    loaded();
    expect(await settled(loading)).toBe(false);
    expect(pause).not.toHaveBeenCalled();

    showFrame();
    await expect(loading).resolves.toBe(video);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('takes a frame the browser showed before loadeddata', async () => {
    stubPlayback();
    const { video, loaded, showFrame } = fakeVideo();
    const loading = loadVideoElement('blob:video');

    showFrame();
    expect(await settled(loading)).toBe(false);

    loaded();
    await expect(loading).resolves.toBe(video);
  });

  // A page that is not on screen shows no frame, and a picture can start long after the sound.
  it('goes on without a shown frame after the frame wait, as it did at loadeddata before', async () => {
    vi.useFakeTimers();
    const { pause } = stubPlayback();
    const { video, loaded } = fakeVideo();
    const loading = loadVideoElement('blob:video');
    loaded();
    expect(await settled(loading)).toBe(false);

    vi.advanceTimersByTime(VIDEO_FRAME_WAIT_MS - 1);
    expect(await settled(loading)).toBe(false);

    vi.advanceTimersByTime(1);
    await expect(loading).resolves.toBe(video);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not wait for a frame of a file with no picture to decode', async () => {
    stubPlayback();
    const { video, loaded } = fakeVideo(0);
    const loading = loadVideoElement('blob:sound-only');

    loaded();
    await expect(loading).resolves.toBe(video);
  });

  it('stops both timers once the frame is shown', async () => {
    vi.useFakeTimers();
    stubPlayback();
    const { video, loaded, showFrame } = fakeVideo();
    const loading = loadVideoElement('blob:video');
    loaded();
    expect(await settled(loading)).toBe(false);
    expect(vi.getTimerCount()).toBe(2);

    showFrame();
    await expect(loading).resolves.toBe(video);
    expect(vi.getTimerCount()).toBe(0);
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
