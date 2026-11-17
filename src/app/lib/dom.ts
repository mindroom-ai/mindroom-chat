import { Capacitor } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';

// This module is the only place that touches the native, browser and legacy clipboard APIs
// (dom.clipboard-ownership.test.ts enforces it).

/** The browser clipboard, which exists only in a secure context. */
export const getBrowserClipboard = (): Clipboard | undefined =>
  typeof navigator === 'undefined' ? undefined : navigator.clipboard ?? undefined;

const copyWithNativeClipboard = async (text: string): Promise<boolean> => {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('Clipboard')) return false;
  try {
    await Clipboard.write({ string: text });
    return true;
  } catch {
    return false;
  }
};

const copyWithBrowserClipboard = async (text: string): Promise<boolean> => {
  const clipboard = getBrowserClipboard();
  if (typeof clipboard?.writeText !== 'function') return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

// The pre-Clipboard API way: select the text in a hidden field and run the copy command.
const copyWithSelection = (text: string): boolean => {
  if (typeof document === 'undefined' || !document.body) return false;
  const input = document.createElement('input');
  input.setAttribute('data-clipboard-fallback', '');
  input.setAttribute('aria-hidden', 'true');
  input.readOnly = true;
  input.value = text;
  // eslint-disable-next-line no-restricted-syntax -- off screen; either edge hides it
  Object.assign(input.style, { position: 'fixed', top: '0', left: '-9999px', opacity: '0' });
  document.body.appendChild(input);
  try {
    input.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    input.remove();
  }
};

/** Copies text with the first clipboard that works: native, browser, then the copy command. */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  if (await copyWithNativeClipboard(text)) return true;
  if (await copyWithBrowserClipboard(text)) return true;
  return copyWithSelection(text);
};

const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Whether keyboard input goes to a field now: an input, a select, or editable content has focus. */
export const editableActiveElement = (): boolean => {
  if (typeof document === 'undefined') return false;
  const focused = document.activeElement;
  if (!focused || focused === document.body) return false;
  return (
    TEXT_ENTRY_TAGS.has(focused.tagName) ||
    (focused instanceof HTMLElement && focused.isContentEditable)
  );
};

/**
 * Whether the reader can select text in `target`, the element under a viewport point, within
 * `reach` CSS pixels of that point. All of the target's text counts, so a point beside a bold word
 * or between two formatted ones, which lands on the enclosing block, finds them. The empty space
 * beside a line's end, button labels (a hidden spoiler is a button too) and text styled
 * unselectable do not count. WebKit and Blink inherit `user-select`, so a text's parent holds its
 * ancestors' `none`.
 */
export const selectableTextNear = (
  target: EventTarget,
  x: number,
  y: number,
  reach: number
): boolean => {
  if (!(target instanceof Element)) return false;
  const range = document.createRange();
  const texts = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  for (let node = texts.nextNode(); node; node = texts.nextNode()) {
    const parent = node.parentElement;
    if (!parent || !node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    const near = Array.from(range.getClientRects()).some(
      (line) =>
        x >= line.left - reach &&
        x <= line.right + reach &&
        y >= line.top - reach &&
        y <= line.bottom + reach
    );
    if (near && !parent.closest('button, [role="button"]')) {
      const style = getComputedStyle(parent);
      const select =
        style.getPropertyValue('-webkit-user-select') || style.getPropertyValue('user-select');
      if (select !== 'none') return true;
    }
  }
  return false;
};

/** Scrolls to the end of the content; instantly unless asked to animate. */
export const scrollToBottom = (
  scrollElement: HTMLElement,
  behavior: ScrollBehavior = 'instant'
): void => {
  scrollElement.scrollTo({
    top: Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight),
    behavior,
  });
};

/** Pauses every audio and video element, so a recording or call does not compete with them. */
export const pauseAllMediaElements = (): void => {
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((media) => media.pause());
};

/**
 * Opens the file picker and resolves with the chosen file, the chosen files when `multiple`, or
 * nothing when the picker is cancelled. The input is attached to the page while open (iOS needs
 * that) and removed afterwards.
 */
export function selectFile(accept: string): Promise<File | undefined>;
export function selectFile(accept: string, multiple: true): Promise<File[]>;
export function selectFile(accept: string, multiple?: boolean): Promise<File | File[] | undefined>;
export function selectFile(accept: string, multiple = false): Promise<File | File[] | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    Object.assign(input.style, {
      position: 'fixed',
      // eslint-disable-next-line no-restricted-syntax -- off screen; either edge hides it
      left: '-9999px',
      opacity: '0',
      pointerEvents: 'none',
    });

    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.removeEventListener('change', onChange);
      input.removeEventListener('cancel', onCancel);
      input.remove();
      resolve(multiple ? files : files[0]);
    };
    const onChange = () => {
      const { files } = input;
      const chosen: File[] = [];
      for (let index = 0; files && index < files.length; index += 1) {
        const file = files.item(index);
        if (file) chosen.push(file);
      }
      finish(chosen);
    };
    const onCancel = () => finish([]);

    input.addEventListener('change', onChange);
    input.addEventListener('cancel', onCancel);
    document.body.appendChild(input);
    input.click();
  });
}

const encodeCanvas = (canvas: HTMLCanvasElement, mimeType: string): Promise<Blob | undefined> =>
  new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? undefined), mimeType);
  });

/** Draws `source` at the given size and encodes it, or resolves undefined when the canvas cannot. */
export const getThumbnail = async (
  source: CanvasImageSource,
  width: number,
  height: number,
  thumbnailMimeType = 'image/jpeg'
): Promise<Blob | undefined> => {
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const context = canvas.getContext('2d');
  if (context === null) return undefined;

  context.drawImage(source, 0, 0, width, height);
  return encodeCanvas(canvas, thumbnailMimeType);
};

/** Loads an image from a URL, for its dimensions or to draw a thumbnail. */
export const loadImageElement = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = document.createElement('img');
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error(`Could not load image ${url}`)), {
      once: true,
    });
    image.src = url;
  });

/** How long a video may take to show its first frame before it is sent without one. */
export const VIDEO_LOAD_TIMEOUT_MS = 10_000;

/** Inside the first frame of any video. A seek to the current time, zero, loads nothing. */
const FIRST_FRAME_SECONDS = 0.001;

/**
 * Loads a video up to its first frame, for its dimensions or to draw a thumbnail. A seek asks
 * for the frame, so the video never plays: WebKit loads only the metadata of a video that
 * neither plays nor seeks, and one that plays until `loadeddata` often has no frame to draw
 * there yet. Rejects on the video's `error`, and when no frame is there after
 * `VIDEO_LOAD_TIMEOUT_MS`, so a send never waits on it.
 */
export const loadVideoElement = (url: string): Promise<HTMLVideoElement> => {
  const video = document.createElement('video');
  Object.assign(video, { preload: 'metadata', playsInline: true, muted: true });
  return new Promise((resolve, reject) => {
    const listeners = new AbortController();
    const on = (event: string, listener: () => void) =>
      video.addEventListener(event, listener, { signal: listeners.signal });
    const ready = () => {
      listeners.abort();
      resolve(video);
    };
    const fail = (reason: string) => {
      listeners.abort();
      // Ends the load, so the element no longer holds the file.
      video.removeAttribute('src');
      video.load();
      reject(new Error(`Could not load video ${url}${reason}`));
    };
    const timer = setTimeout(
      () => fail(` within ${VIDEO_LOAD_TIMEOUT_MS} ms`),
      VIDEO_LOAD_TIMEOUT_MS
    );
    listeners.signal.addEventListener('abort', () => clearTimeout(timer));

    // The frame can be drawn once the browser has shown one and the seek has ended. Neither is
    // enough alone: Safari ends the seek up to a second before it has the frame, and Firefox
    // shows a frame it cannot draw yet while it seeks. A browser that cannot tell when it shows
    // a frame counts as having shown it.
    const tellsFrames = 'requestVideoFrameCallback' in video;
    let frameShown = !tellsFrames;
    const readyIfDrawable = () => {
      if (frameShown && !video.seeking) ready();
    };
    const onFrame = () => {
      if (listeners.signal.aborted) return;
      frameShown = true;
      readyIfDrawable();
      // Still seeking: the next frame looks again, as a seek the browser drops (Safari, for
      // WebM) ends without a `seeked`.
      if (!listeners.signal.aborted) video.requestVideoFrameCallback(onFrame);
    };
    on('loadedmetadata', () => {
      // No picture the browser can decode (only sound): no frame will come.
      if (video.videoWidth === 0) {
        ready();
        return;
      }
      if (tellsFrames) video.requestVideoFrameCallback(onFrame);
      video.currentTime = FIRST_FRAME_SECONDS;
    });
    on('seeked', readyIfDrawable);
    on('loadeddata', readyIfDrawable);
    on('error', () => fail(''));
    video.src = url;
  });
};

export const getDataTransferFiles = (dataTransfer: DataTransfer): File[] | undefined => {
  const files = Array.from(dataTransfer.files ?? []);
  return files.length > 0 ? files : undefined;
};
