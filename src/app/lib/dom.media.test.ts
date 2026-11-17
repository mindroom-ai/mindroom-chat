// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getThumbnail, loadImageElement, loadVideoElement, VIDEO_LOAD_TIMEOUT_MS } from './dom';

afterEach(() => {
  vi.restoreAllMocks();
});

// jsdom never loads media, so the tests fire the element's events by hand.
const settleLater = (event: 'load' | 'error') => {
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const element = create(tag);
    if (tag === 'img') {
      Object.defineProperty(element, 'src', {
        configurable: true,
        set: () => queueMicrotask(() => element.dispatchEvent(new Event(event))),
      });
    }
    return element;
  }) as typeof document.createElement);
};

type FakeVideoOptions = {
  /** Whether the browser tells when it shows a frame (`requestVideoFrameCallback`). */
  tellsFrames?: boolean;
  /** Zero for a file whose picture the browser cannot decode. */
  videoWidth?: number;
  /** False for a browser that drops the seek, as Safari does for WebM. */
  seeks?: boolean;
};

/**
 * The next video element `loadVideoElement` creates, with the state a browser would give it.
 * `fire` dispatches an event, `showFrame` runs the pending frame callbacks, and `endSeek` ends
 * the seek and fires `seeked`.
 */
const fakeVideo = ({ tellsFrames = false, videoWidth = 1206, seeks = true }: FakeVideoOptions) => {
  const video = document.createElement('video');
  const state = { seeking: false, seekedTo: undefined as number | undefined };
  const load = vi.fn();
  let frameCallbacks: Array<() => void> = [];
  Object.defineProperties(video, {
    videoWidth: { value: videoWidth },
    seeking: { get: () => state.seeking },
    currentTime: {
      get: () => state.seekedTo ?? 0,
      set: (seconds: number) => {
        state.seekedTo = seconds;
        state.seeking = seeks;
      },
    },
    load: { value: load },
  });
  if (tellsFrames) {
    Object.defineProperty(video, 'requestVideoFrameCallback', {
      value: (callback: () => void) => frameCallbacks.push(callback),
    });
  }
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'video' ? video : create(tag)) as typeof document.createElement);
  return {
    video,
    state,
    load,
    fire: (event: string) => video.dispatchEvent(new Event(event)),
    showFrame: () => {
      const callbacks = frameCallbacks;
      frameCallbacks = [];
      callbacks.forEach((callback) => callback());
    },
    endSeek: () => {
      state.seeking = false;
      video.dispatchEvent(new Event('seeked'));
    },
  };
};

/** Whether `promise` has settled, after the microtasks queued so far have run. */
const settled = async (promise: Promise<unknown>): Promise<boolean> => {
  let done = false;
  promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    }
  );
  await Promise.resolve();
  await Promise.resolve();
  return done;
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
  // A browser may refuse to play a video nobody started; a seek needs no such leave.
  it('creates a muted, inline video that preloads its metadata and never plays', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play');
    const { video, fire, endSeek } = fakeVideo({});
    const loading = loadVideoElement('blob:video');
    fire('loadedmetadata');
    endSeek();

    await expect(loading).resolves.toBe(video);
    expect(video.preload).toBe('metadata');
    expect(video.playsInline).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.getAttribute('src')).toBe('blob:video');
    expect(play).not.toHaveBeenCalled();
  });

  // An iPhone loads only the metadata of a video that does not play: `loadeddata` never comes.
  it('seeks to the first frame once the metadata is there, without waiting for loadeddata', async () => {
    const { video, state, fire, endSeek } = fakeVideo({});
    const loading = loadVideoElement('blob:video');
    expect(state.seekedTo).toBeUndefined();

    fire('loadedmetadata');
    expect(state.seekedTo).toBe(0.001);
    expect(await settled(loading)).toBe(false);

    endSeek();
    await expect(loading).resolves.toBe(video);
  });

  // Chrome fires `loadeddata` while the seek for the frame is still going, with nothing to draw.
  it('does not take loadeddata for the frame while the seek is going', async () => {
    const { video, fire, endSeek } = fakeVideo({});
    const loading = loadVideoElement('blob:video');
    fire('loadedmetadata');

    fire('loadeddata');
    expect(await settled(loading)).toBe(false);

    endSeek();
    await expect(loading).resolves.toBe(video);
  });

  // Safari drops the seek for a WebM file and fires no `seeked`.
  it('takes loadeddata for the frame when the browser dropped the seek', async () => {
    const { video, fire } = fakeVideo({ seeks: false });
    const loading = loadVideoElement('blob:video');
    fire('loadedmetadata');
    expect(await settled(loading)).toBe(false);

    fire('loadeddata');
    await expect(loading).resolves.toBe(video);
  });

  // Safari ends the seek up to a second before it has the frame.
  it('waits for the browser to show a frame after the seek ended', async () => {
    const { video, fire, endSeek, showFrame } = fakeVideo({ tellsFrames: true });
    const loading = loadVideoElement('blob:video');
    fire('loadedmetadata');

    endSeek();
    fire('loadeddata');
    expect(await settled(loading)).toBe(false);

    showFrame();
    await expect(loading).resolves.toBe(video);
  });

  // Firefox shows a frame it cannot draw yet while it seeks.
  it('waits for the seek to end after the browser showed a frame', async () => {
    const { video, fire, endSeek, showFrame } = fakeVideo({ tellsFrames: true });
    const loading = loadVideoElement('blob:video');
    fire('loadedmetadata');

    showFrame();
    expect(await settled(loading)).toBe(false);

    endSeek();
    await expect(loading).resolves.toBe(video);
  });

  it('takes the next frame when one shown during a dropped seek was the only sign', async () => {
    const { video, state, fire, showFrame } = fakeVideo({ tellsFrames: true });
    const loading = loadVideoElement('blob:video');
    fire('loadedmetadata');

    showFrame();
    expect(await settled(loading)).toBe(false);

    // The seek ends without a `seeked`.
    state.seeking = false;
    showFrame();
    await expect(loading).resolves.toBe(video);
  });

  it('resolves at once, without a seek, for a file with no picture to decode', async () => {
    const { video, state, fire } = fakeVideo({ tellsFrames: true, videoWidth: 0 });
    const loading = loadVideoElement('blob:sound-only');
    fire('loadedmetadata');

    await expect(loading).resolves.toBe(video);
    expect(state.seekedTo).toBeUndefined();
  });

  it('rejects naming the url when the video fails, and lets the file go', async () => {
    const { video, load, fire } = fakeVideo({});
    const loading = loadVideoElement('blob:broken');
    fire('error');

    await expect(loading).rejects.toThrow('Could not load video blob:broken');
    expect(video.hasAttribute('src')).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('rejects when no frame is there in time, and lets the file go', async () => {
    vi.useFakeTimers();
    try {
      const { video, load, fire, showFrame } = fakeVideo({ tellsFrames: true });
      const loading = loadVideoElement('blob:stuck');
      fire('loadedmetadata');

      vi.advanceTimersByTime(VIDEO_LOAD_TIMEOUT_MS - 1);
      expect(await settled(loading)).toBe(false);

      vi.advanceTimersByTime(1);
      await expect(loading).rejects.toThrow(
        `Could not load video blob:stuck within ${VIDEO_LOAD_TIMEOUT_MS} ms`
      );
      expect(video.hasAttribute('src')).toBe(false);
      expect(load).toHaveBeenCalledTimes(1);

      // A frame that comes after all changes nothing and asks for no further frame.
      showFrame();
      showFrame();
      await expect(loading).rejects.toThrow('blob:stuck within');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops its deadline once the frame is there', async () => {
    vi.useFakeTimers();
    try {
      const { video, load, fire, endSeek } = fakeVideo({});
      const loading = loadVideoElement('blob:video');
      fire('loadedmetadata');
      endSeek();
      await expect(loading).resolves.toBe(video);

      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(2 * VIDEO_LOAD_TIMEOUT_MS);
      expect(video.getAttribute('src')).toBe('blob:video');
      expect(load).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
