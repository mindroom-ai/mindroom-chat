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

/** Whether `child` is fully inside the visible part of `scrollElement`. */
export const isInScrollView = (scrollElement: HTMLElement, child: HTMLElement): boolean => {
  const view = scrollElement.getBoundingClientRect();
  const rect = child.getBoundingClientRect();
  return rect.top >= view.top && rect.bottom <= view.bottom;
};

/** Whether any part of `child` is inside the visible part of `scrollElement`. */
export const isIntersectingScrollView = (
  scrollElement: HTMLElement,
  child: HTMLElement
): boolean => {
  const view = scrollElement.getBoundingClientRect();
  const rect = child.getBoundingClientRect();
  return rect.bottom > view.top && rect.top < view.bottom;
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

/** Draws `source` at the given size and encodes it, or resolves undefined when the canvas cannot. */
export const getThumbnail = (
  source: CanvasImageSource,
  width: number,
  height: number,
  thumbnailMimeType = 'image/jpeg'











    canvas.toBlob((blob) => resolve(blob ?? undefined), thumbnailMimeType);



















      video.onloadeddata = null;
      resolve(video);
    };
    video.onerror = () => reject(new Error(`Could not load video ${url}`));
    video.src = url;
  });

export const getDataTransferFiles = (dataTransfer: DataTransfer): File[] | undefined => {
  const files = Array.from(dataTransfer.files ?? []);
  return files.length > 0 ? files : undefined;
};
