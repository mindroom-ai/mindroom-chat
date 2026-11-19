/**
 * Memory the page holds outside the JS heap, for the deep trace's memory samples: the iOS web view
 * process was seen at 1.5 GB while the DOM and the client's counts stayed small. Covers the
 * WebAssembly memories (the crypto module's grows and never shrinks), the blobs behind live object
 * URLs, decoded images, media elements and canvases.
 *
 * WebAssembly memories and object URLs can only be seen as they are made, so `installMemoryHooks`
 * wraps their constructors while the deep trace records. The crypto module's memory is seen only
 * when the trace already records as the app starts (it stays on across launches); turned on later,
 * it needs a reload.
 */

const BYTES_PER_MB = 1024 * 1024;

const toMb = (bytes: number): number => Math.round((bytes / BYTES_PER_MB) * 10) / 10;

const wasmMemories: WeakRef<WebAssembly.Memory>[] = [];
// The same memory can be exported under several names or by several instances.
let seenMemories = new WeakSet<WebAssembly.Memory>();
const objectUrlBytes = new Map<string, number>();
let uninstallHooks: (() => void) | undefined;

const trackInstance = (instance: WebAssembly.Instance): void => {
  Object.values(instance.exports).forEach((value) => {
    if (!(value instanceof WebAssembly.Memory) || seenMemories.has(value)) return;
    seenMemories.add(value);
    wasmMemories.push(new WeakRef(value));
  });
};

const trackResult = <T>(result: T): T => {
  try {
    const instance =
      result instanceof WebAssembly.Instance
        ? result
        : (result as Partial<WebAssembly.WebAssemblyInstantiatedSource>).instance;
    if (instance instanceof WebAssembly.Instance) trackInstance(instance);
  } catch {
    // Tracking must never fail the module's own load.
  }
  return result;
};

const hookWebAssembly = (restores: Array<() => void>): void => {
  if (typeof WebAssembly === 'undefined') return;
  const { instantiate, instantiateStreaming } = WebAssembly;
  if (typeof instantiate === 'function') {
    WebAssembly.instantiate = ((...args: Parameters<typeof instantiate>) =>
      instantiate.apply(WebAssembly, args).then(trackResult)) as typeof instantiate;
    restores.push(() => {
      WebAssembly.instantiate = instantiate;
    });
  }
  if (typeof instantiateStreaming === 'function') {
    WebAssembly.instantiateStreaming = ((...args: Parameters<typeof instantiateStreaming>) =>
      instantiateStreaming
        .apply(WebAssembly, args)
        .then(trackResult)) as typeof instantiateStreaming;
    restores.push(() => {
      WebAssembly.instantiateStreaming = instantiateStreaming;
    });
  }
};

// The browser's own getter: a blob's `size` property could be anything.
const blobSize = (obj: Blob | MediaSource): number => {
  try {
    const getter = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')?.get;
    const size: unknown = obj instanceof Blob ? getter?.call(obj) : 0;
    return typeof size === 'number' ? size : 0;
  } catch {
    return 0;
  }
};

const hookObjectUrls = (restores: Array<() => void>): void => {
  const { createObjectURL, revokeObjectURL } = URL;
  if (typeof createObjectURL !== 'function' || typeof revokeObjectURL !== 'function') return;
  URL.createObjectURL = (obj: Blob | MediaSource): string => {
    const url = createObjectURL.call(URL, obj);
    objectUrlBytes.set(url, blobSize(obj));
    return url;
  };
  URL.revokeObjectURL = (url: string): void => {
    objectUrlBytes.delete(url);
    revokeObjectURL.call(URL, url);
  };
  restores.push(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });
};

/**
 * Wraps WebAssembly instantiation and object URL creation; while installed, a second call returns
 * the same function. That function puts the originals back and forgets what was seen.
 */
export const installMemoryHooks = (): (() => void) => {
  if (uninstallHooks) return uninstallHooks;
  const restores: Array<() => void> = [];
  try {
    hookWebAssembly(restores);
    hookObjectUrls(restores);
  } catch {
    // A browser that refuses the wrappers just reports fewer counters.
  }
  const uninstall = () => {
    if (uninstallHooks !== uninstall) return;
    uninstallHooks = undefined;
    restores.forEach((restore) => restore());
    wasmMemories.length = 0;
    seenMemories = new WeakSet();
    objectUrlBytes.clear();
  };
  uninstallHooks = uninstall;
  return uninstall;
};

/** MB of the WebAssembly memories still alive; undefined until a module with one has loaded. */
export const readWasmMemoryMb = (): number | undefined => {
  let bytes = 0;
  let live = 0;
  for (let index = wasmMemories.length - 1; index >= 0; index -= 1) {
    const memory = wasmMemories[index]!.deref();
    if (memory) {
      bytes += memory.buffer.byteLength;
      live += 1;
    } else {
      wasmMemories.splice(index, 1);
    }
  }
  return live > 0 ? toMb(bytes) : undefined;
};

/**
 * The `memory.media` counters. Decoded image and canvas sizes are estimates at 4 bytes a pixel,
 * from the elements in the document only: an image still decoded after it left the DOM, or a
 * canvas never attached, is not seen.
 */
export const readMediaMemory = () => {
  let blobBytes = 0;
  objectUrlBytes.forEach((size) => {
    blobBytes += size;
  });
  let imagePixels = 0;
  const { images } = document;
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index]!;
    if (image.complete) imagePixels += image.naturalWidth * image.naturalHeight;
  }
  let canvasPixels = 0;
  const canvases = document.getElementsByTagName('canvas');
  for (let index = 0; index < canvases.length; index += 1) {
    canvasPixels += canvases[index]!.width * canvases[index]!.height;
  }
  return {
    object_urls: objectUrlBytes.size,
    object_url_mb: toMb(blobBytes),
    images: images.length,
    image_decoded_mb: toMb(imagePixels * 4),
    media_elements:
      document.getElementsByTagName('video').length + document.getElementsByTagName('audio').length,
    canvases: canvases.length,
    canvas_mb: toMb(canvasPixels * 4),
  };
};
